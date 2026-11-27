import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Dialog, DropdownMenu } from 'radix-ui';
import { filterOn, groupLabel, listInfo, okLink, platformLabel, sameGroup, samePlatform, type Job, type JobFilter, type JobNote, type JobState, type Platform } from '../lib/jobs';
import { CHANNEL_LABEL } from '../../shared/types';
import { MARKETS, type Market } from '../../shared/markets';
import { fmtBytes } from '../lib/util';
import { SHARED_ROOT, findSharedPsd } from '../lib/sharedFolder';
import Select from './Select';
import PeriodPicker from './PeriodPicker';
import { CheckField, Tip, TipWrap } from './ui';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpDown, Check, CopyPlus, Ellipsis, ExternalLink, FileUp, ImageOff, Lock, LockOpen, Pencil, RotateCcw, Trash2, X } from 'lucide-react';
import ImageDeleteDialog, { type DeleteAfter } from './ImageDeleteDialog';
import JobInfoDialog from './JobInfoDialog';
import ReplacePsdDialog from './ReplacePsdDialog';
import { ago, clock, dayHeading, listDate, when } from '../lib/time';

/** 다른 PC 에서 열 PSD 가 있는 곳 (「공유 폴더에 저장」이 PSD 를 넣는 폴더) */
const PSD_DIR = String.raw`${SHARED_ROOT}\채널\제품명`;

interface Props {
  jobs: Job[];
  /** 변환 내역 거르기 (채널·플랫폼·상태·기간·검색) — 서버에서 거른 뒤 20개씩 */
  filter: JobFilter;
  onFilter: (f: JobFilter) => void;
  currentId: string | null;
  /** 생성 중엔 다른 작업을 열거나 지우지 않는다 */
  busy: boolean;
  /** 로그인한 계정에 저장 중이면 true (아니면 이 브라우저에만) */
  account: boolean;
  /** 더 오래된 작업이 남아 있음 */
  more: boolean;
  /** 목록을 읽는 중 (처음 열 때·더 보기) */
  loading: boolean;
  onMore: () => void;
  /** 변환 내역 페이지 (0부터) · 거르기에 맞는 전체 개수 · 한 페이지 개수 · 페이지 이동 — onPage 가 있으면 「더 보기」 대신 페이지 번호 */
  page?: number;
  total?: number;
  pageSize?: number;
  onPage?: (page: number) => void;
  /** 목록 다시 그리기 (작업 기록이 바뀐 뒤 — 이미지 지운 뒤 「올리기 전」 등) */
  onRefresh?: () => void;
  /** file: 이 브라우저에 PSD 원본이 없을 때 사용자가 고른 PSD */
  onOpen: (job: Job, file?: File) => void;
  onRemove: (id: string) => void;
  /** 같은 PSD 를 다른 판매처용 새 작업으로 만들어 연다 (원래 작업은 그대로) — 변환 내역 화면에서만 */
  onCopy?: (job: Job, to: Platform) => void;
  /** 「⋯ → 작업 정보 편집」 저장 — 담당자·메모·테스트만 (PSD 없이, 결과 영향 없음). 실패하면 throw */
  onEditInfo?: (job: Job, note: JobNote) => Promise<void>;
  /** 「⋯ → PSD 교체…」 — 같은 작업에 디자인을 고친 PSD 를 넣는다 (설정·기록은 그대로, 옛 결과는 비움) */
  onReplace?: (job: Job, file: File) => void;
  /** PSD 원본 없이 저장된 결과(HTML) 보기 */
  onView: (job: Job) => void;
  /** 휴지통 목록 — null 이면 닫힘(최근 작업을 보여 줌) */
  trash: Job[] | null;
  /** 휴지통 개수 (머리의 「휴지통 n」) */
  trashN: number;
  trashLoading: boolean;
  onTrashOpen: () => void;
  onTrashClose: () => void;
  /** 휴지통에서 복원 (여러 개 가능) */
  onRestore: (ids: string | string[]) => void;
  /** 영구 삭제 */
  /** 휴지통에서 영구 삭제 (여러 개) — 이미지 서버 정리는 휴지통 화면의 확인 창에서 먼저 */
  onPurge: (ids: string[]) => void;
  /**
   * 'recent' = 만들기 화면의 「최근 작업」(최근 5건·거르기/휴지통/더 보기 없음 + 「전체 보기」),
   * 'page' = 머리말 메뉴 「변환 내역」 화면 (#jobs — 거르기·휴지통·더 보기, 비어 있어도 그린다)
   */
  mode: 'recent' | 'page';
  /** 'recent' 의 「전체 보기」 — 변환 내역 화면으로 */
  onShowAll?: () => void;
  /** 'page' 에서 지금 열린 작업 줄의 「작업 화면으로」 — 만들기 화면으로 돌아간다 (열린 작업은 거기 그대로 있음) */
  onGoCurrent?: () => void;
  /** 이미지 서버 업로드가 설정돼 있음 — 줄 끝 「⋯」에 「이미지 서버에서 지우기」를 보인다 */
  imageServer?: boolean;
}

type SortKey = 'name' | 'channel' | 'who' | 'state' | 'time';
/** 변환 내역 표 머리 (누르면 정렬) — [기준, 이름, 칸 class] */
const SORT_COLS: [SortKey, string, string][] = [
  ['name', '제품명', 'jtable__c-name'],
  ['channel', '판매처', 'jtable__c-ch'],
  ['who', '담당', 'jtable__c-who'],
  ['state', '상태', 'jtable__c-state'],
  ['time', '날짜', 'jtable__c-time'],
];
/** 정렬 방향 화살표 (오름차순 위 · 내림차순 아래 · 정렬 안 한 칸은 위아래) — lucide 아이콘 */
function SortArrow({ dir }: { dir: 1 | -1 | 0 }) {
  const Icon = dir === 1 ? ArrowUp : dir === -1 ? ArrowDown : ArrowUpDown;
  return <Icon className="jtable__dir" />;
}
/** 표 날짜 칸 — 오늘 「오늘 12:16 pm」 · 어제 이전 「2026.11.25」 (2026-11-26 사용자). 정확한 시각·몇 시간 전은 마우스를 올리면 툴팁으로 */
const dateCell = listDate;
/** 상태 정렬 순서: 손볼 것(오류·중단) 먼저 */
const STATE_ORDER: Record<JobState, number> = { error: 0, stopped: 1, running: 2, ready: 3, done: 4 };
function sortCmp(k: SortKey, x: Job, y: Job) {
  if (k === 'time') return x.updatedAt - y.updatedAt;
  if (k === 'state') return STATE_ORDER[x.state] - STATE_ORDER[y.state] || y.updatedAt - x.updatedAt;
  const key = (j: Job) => (k === 'name' ? j.settings.productName || j.fileName : k === 'who' ? whoOf(j) : `${groupOf(j)} ${channelOf(j)}`);
  return key(x).localeCompare(key(y), 'ko') || y.updatedAt - x.updatedAt;
}

/** 담당 — 담당자 칸을 비웠으면 만든 사람 (예전 작업은 둘 다 없음) */
const whoOf = (j: Job) => j.note?.assignee?.trim() || j.creator || '';
/** 담당 칸 마우스 올림 글 — 담당자와 만든 사람이 다르면 둘 다 */
const whoTip = (j: Job) => {
  if (!j.creator) return undefined;
  const a = j.note?.assignee?.trim();
  return a && a !== j.creator ? `담당 ${a} · 만든 사람 ${j.creator}` : `만든 사람 ${j.creator}`;
};

/** 제품명 아래 줄에 붙는 메모 (변환 내역 표와 최근 작업 목록 공용) — 「테스트」 표시는 제목 줄 배지로 */
/** 작업 메모 (없으면 빈 글자) — 변환 내역 이름 칸 둘째 줄에 크기와 함께 */
const memoOf = (j: Job) => j.note?.memo?.trim() ?? '';

/** 만들기 화면에 보여 줄 최근 작업 수 (사용자 지시 2026-11-24) */
export const RECENT_COUNT = 5;

/** 상태 배지 — tip 은 마우스를 올리거나 초점을 주면 뜨는 뜻풀이 (2026-11-26 사용자) */
const STATE: Record<JobState, { label: string; tone: string; tip: string }> = {
  ready: { label: '준비', tone: '', tip: 'PSD 를 열었고\n아직 마크업을 만들지 않았습니다' },
  running: { label: '만드는 중', tone: 'acc', tip: '마크업을 만드는 중입니다' },
  stopped: { label: '중단됨', tone: 'warn', tip: '만들다 멈췄습니다\n열어서 이어서 만들 수 있습니다' },
  error: { label: '오류', tone: 'error', tip: '만들다 오류가 났습니다\n제품명에 마우스를 올리면 이유가 보입니다' },
  done: { label: '완료', tone: 'ok', tip: '마크업을 다 만들었습니다' },
};

/** 스켈레톤 줄의 제목 자리 — 길이를 조금씩 달리해 실제 목록처럼 보이게 */
const SKEL_NAMES = ['상세페이지 제품명 자리', '제품명 자리 표시', '상세페이지 제품 이름 자리 표시'];

/** 예전 작업엔 settings 가 비어 있을 수 있다 → 판매처를 모르면 빈 글자 */
const known = (j: Job) => !!j.settings?.channel && !!CHANNEL_LABEL[j.settings.channel];
/** 판매처 이름 (제품명 옆 배지) */
const channelOf = (j: Job) => (known(j) ? platformLabel(j.settings) : '');
/** 판매처 칸 — 묶음(고도몰 · 오픈마켓). 어느 쇼핑몰인지는 제품명 옆 배지로 (2026-11-25 의견: 배지 = 판매처, 칸 = 묶음) */
const groupOf = (j: Job) => (known(j) ? groupLabel(j.settings.channel) : '');

/**
 * 제품명 + 판매처 배지(아이티켓·쿠팡 — 색은 묶음: 고도몰 보라 · 오픈마켓 주황) + 「테스트」 배지(점선 테두리 — 주황과 헷갈리지 않게).
 * 배지는 색 있는 표시만 — 회색 면·파란 옅은 면은 단추(.btn·.btn--soft)와 헷갈려서 쓰지 않는다
 */
/** 배지 뜻풀이 툴팁이 뜨기까지 (ms) — 바로 뜨면 지나가다 걸려 불편하고, 기본 0.25초는 느리다 (2026-11-26 사용자) */
const BADGE_TIP_DELAY = 150;

function NameLine({ j }: { j: Job }) {
  const ch = channelOf(j);
  const om = j.settings?.channel === 'openmarket';
  // 이름 칸이 단추라 배지는 초점을 받지 않는다 (단추 안에 초점 요소를 두지 않음) — 마우스를 올리면 뜻풀이
  return (
    <span className="jobs__title">
      <b>{j.settings.productName || j.fileName}</b>
      {ch && (
        <Tip content={`${om ? '오픈마켓' : '고도몰'} 판매처\n${ch}용으로 만든 결과입니다`} delay={BADGE_TIP_DELAY}>
          <span className={`badge badge--${om ? 'om' : 'godo'} jobs__group jobs__tipbadge`}>{ch}</span>
        </Tip>
      )}
      {j.note?.test && (
        <Tip content={'테스트용 작업\n거르기의 「테스트 제외」로 숨길 수 있습니다'} delay={BADGE_TIP_DELAY}>
          <span className="badge badge--test jobs__group jobs__tipbadge">테스트</span>
        </Tip>
      )}
      {/* 쇼핑몰에 등록한 페이지가 있으면 「등록」 — 페이지 열기는 줄 끝 ⋯ 메뉴 (이름 칸 전체가 단추라 링크를 겹쳐 둘 수 없다) */}
      {linkOf(j) && (
        <Tip content={`쇼핑몰에 등록한 페이지\n${linkOf(j)}`} delay={BADGE_TIP_DELAY}>
          <span className="badge badge--ok jobs__group jobs__tipbadge">
            <Check className="jobs__group-ico" aria-hidden="true" />
            등록
          </span>
        </Tip>
      )}
      {/* 잠긴 작업 — 휴지통·이미지 지우기·일괄 선택이 막혀 있다 (⋯ 메뉴에서 풀기) */}
      {heldOf(j) && (
        <Tip content={'잠긴 작업\n휴지통·이미지 지우기·일괄 선택이 막혀 있습니다 (⋯ 메뉴에서 풀기)'} delay={BADGE_TIP_DELAY}>
          <span className="badge jobs__group jobs__tipbadge">
            <Lock className="jobs__group-ico" aria-hidden="true" />
            잠금
          </span>
        </Tip>
      )}
    </span>
  );
}

/** 작업에 저장된 등록 페이지 주소 (주소 모양일 때만, 없으면 빈 글자) */
const linkOf = (j: Job) => (j.note?.link && okLink(j.note.link) ? j.note.link.trim() : '');
/**
 * 잠긴 작업 — 휴지통·이미지 지우기·일괄 선택을 막는다.
 * 쇼핑몰에 등록된 작업(등록 링크 있음)은 기본으로 잠김 (2026-11-26 사용자). ⋯ 메뉴에서 풀면 locked=false 가 저장돼 그 뜻을 따른다
 */
const heldOf = (j: Job) => j.note?.locked ?? !!linkOf(j);
/**
 * 상태 칸 표시 (상태 값은 그대로 done): 등록한 페이지가 있으면 「등록」, 이미지 서버가 있는데 아직 안 올렸으면 「대기」(업로드 대기), 올렸으면 「완료」.
 * 이미지 서버가 없는 환경(로컬 등)은 지금처럼 「완료」
 */
const stateOf = (j: Job, imageServer: boolean) =>
  j.state === 'done' && linkOf(j)
    ? { label: '등록', tone: 'reg', tip: '쇼핑몰에 등록한 페이지가 있습니다\n제품명 아래 「등록한 제품」으로 열 수 있습니다' }
    : j.state === 'done' && imageServer && !j.uploadedAt
      ? { label: '대기', tone: 'pending', tip: '이미지 서버 업로드 대기\n만들었지만 아직 이미지를 올리지 않았습니다' }
      : j.state === 'done' && imageServer
        ? { ...STATE.done, tip: '이미지 서버에 올렸습니다\nHTML 을 쇼핑몰 상세설명에 붙여넣으면 됩니다' }
        : STATE[j.state];

/** 「복제」에서 고를 판매처 (고도몰 2 + 오픈마켓 플랫폼) */
const PLATFORMS: { to: Platform; label: string }[] = ([{ channel: 'itket' }, { channel: 'zbyhp' }, { channel: 'cadkorea' }, { channel: 'oncore' }, ...(Object.keys(MARKETS) as Market[]).map((market) => ({ channel: 'openmarket', market }))] as Platform[]).map((to) => ({ to, label: platformLabel(to) }));

/** 같은 PSD(이름·크기)·같은 제품의 작업 — 「복제」 메뉴에 이미 만든 판매처를 표시 */
const sibling = (a: Job, b: Job) => a.fileName === b.fileName && a.fileSize === b.fileSize && (a.settings.productName ?? '') === (b.settings.productName ?? '');

/**
 * 변환 내역 줄의 「복제」(다른 판매처용) — 같은 PSD 를 고도몰·스마트스토어·쿠팡 등에 모두 올릴 때 (원래 작업은 그대로 두고 새 작업으로).
 * 같은 묶음(고도몰끼리·오픈마켓끼리)은 구조 계획을 옮겨 비용 없이, 묶음이 다르면 새 작업에서 「마크업 만들기」(Claude 1회).
 */
function CopySub({ job, all, busy, onCopy }: { job: Job; all: Job[]; busy: boolean; onCopy: (job: Job, to: Platform) => void }) {
  const from: Platform = { channel: job.settings.channel, market: job.settings.market };
  const planned = listInfo(job).engine === 'code';
  const made = all.filter((j) => j.id !== job.id && !j.deletedAt && sibling(j, job));
  // 하위 메뉴는 마우스를 올리자마자 연다 (Radix 기본은 잠깐 기다렸다 열려서 느리게 느껴짐). 닫기는 Radix 가 그대로 맡는다
  const [open, setOpen] = useState(false);
  // 「⋯」 메뉴 안의 하위 메뉴 (2026-11-25: 복제는 보조 동작이라 행 버튼 대신 ⋯ 메뉴로 옮김 — 열기는 행에 그대로)
  return (
    <DropdownMenu.Sub open={open} onOpenChange={setOpen}>
      <DropdownMenu.SubTrigger className="profile__item" disabled={busy} onPointerEnter={() => !busy && setOpen(true)} aria-label={`「${job.settings.productName || job.fileName}」 다른 판매처용으로 복제`}>
        <span className="jobs__rowmenu-ico">
          <CopyPlus className="btn__ico" />
          다른 판매처용으로 복제
        </span>
        <span aria-hidden="true" className="jobs__copy-arrow">›</span>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent className="profile__pop jobs__copy" sideOffset={14} alignOffset={-8} collisionPadding={8} aria-label="복제할 판매처">
          <div className="jobs__copy-head">
            <b>어느 판매처용으로 복제할까요?</b>
            <span>
              원본({platformLabel(from)})은 그대로 둡니다.
            </span>
          </div>
          <DropdownMenu.Separator className="profile__sep" />
          {PLATFORMS.filter((p) => !samePlatform(p.to, from)).map((p, i, list) => {
            const free = planned && sameGroup(p.to, from);
            const has = made.some((j) => samePlatform(j.settings, p.to));
            const groupStart = i === 0 || (list[i - 1].to.channel === 'openmarket') !== (p.to.channel === 'openmarket');
            return (
              <Fragment key={p.label}>
                {groupStart && i > 0 && <DropdownMenu.Separator className="profile__sep" />}
                {/* 비용·시간은 묶음 단위로 정해져(같은 묶음 + 구조 계획 있음 = 비용 없음) 묶음 제목에 한 번만 (2026-11-26 사용자: 줄마다 반복하지 않게) */}
                {groupStart && (
                  <DropdownMenu.Label className="jobs__copy-group">
                    {groupLabel(p.to.channel)}
                    <span className={free ? 'jobs__copy-free' : 'jobs__copy-cost'}>{free ? '바로 복제 · 비용 없음' : '새로 만들기 · 1~2분 · 비용 발생'}</span>
                  </DropdownMenu.Label>
                )}
                <DropdownMenu.Item className="profile__item" onSelect={() => onCopy(job, p.to)}>
                  <span>{p.label}</span>
                  {has && <small className="jobs__copy-has">이미 있음</small>}
                </DropdownMenu.Item>
              </Fragment>
            );
          })}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

/**
 * 변환 내역 줄 끝 「⋯」 메뉴 — 「작업 정보 편집…」(담당자·메모·테스트, 결과 영향 없음) / 지우는 것: 「이미지 서버에서 지우기…」(올린 이미지 정리, 확인 창) ·
 * 「휴지통으로 옮기기」(기간 안에 복원 가능). 안전한 것을 위에, 지우는 것을 구분선 아래에. 만드는 중인 작업은 모두 못 한다
 */
/**
 * 줄 끝 ⋯ 메뉴. locked = 만드는 중이라 메뉴 자체를 막음 / held = 사용자가 건 잠금 (휴지통·이미지 지우기를 막고 메뉴에서 풀 수 있음)
 */
function RowMenu({ job, locked, held, onHold, canDeleteImages, onEdit, onReplace, onDeleteImages, onTrash, copy }: { job: Job; locked: boolean; held: boolean; onHold?: (on: boolean) => void; canDeleteImages: boolean; onEdit?: () => void; onReplace?: () => void; onDeleteImages: () => void; onTrash: () => void; copy?: ReactNode }) {
  const name = job.settings.productName || job.fileName;
  const heldSub = <small className="jobs__rowmenu-sub">잠긴 작업 — 먼저 잠금을 풀어 주세요</small>;
  return (
    <DropdownMenu.Root modal={false}>
      <TipWrap content={locked ? '만드는 중인 작업은 고치거나 지울 수 없습니다' : '더 보기 — 작업 정보 편집 · 이미지 지우기 · 휴지통으로'} disabled={locked}>
        <DropdownMenu.Trigger className="btn btn--sm btn--icon btn--more" disabled={locked} aria-label={`「${name}」 더 보기`}>
          <Ellipsis className="btn__ico" />
        </DropdownMenu.Trigger>
      </TipWrap>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="profile__pop jobs__rowmenu" align="end" sideOffset={6} collisionPadding={8}>
          {/* 등록한 상품 페이지 (작업 기록 link) — 새 창으로 */}
          {linkOf(job) && (
            <DropdownMenu.Item className="profile__item" onSelect={() => window.open(linkOf(job), '_blank', 'noopener,noreferrer')}>
              <span className="jobs__rowmenu-ico">
                <ExternalLink className="btn__ico" />
                등록한 페이지 열기
              </span>
            </DropdownMenu.Item>
          )}
          {copy && (
            <>
              {copy}
            </>
          )}
          {onEdit && (
            <>
              <DropdownMenu.Item className="profile__item" onSelect={onEdit}>
                <span className="jobs__rowmenu-ico">
                  <Pencil className="btn__ico" />
                  작업 정보 편집…
                </span>
                <small className="jobs__rowmenu-sub">담당 · 메모 · 테스트</small>
              </DropdownMenu.Item>
            </>
          )}
          {/* PSD 교체 — 디자인을 고친 PSD 로 같은 작업을 다시 만든다 (2026-11-27) */}
          {onReplace && (
            <DropdownMenu.Item className="profile__item" onSelect={onReplace}>
              <span className="jobs__rowmenu-ico">
                <FileUp className="btn__ico" />
                PSD 교체…
              </span>
              <small className="jobs__rowmenu-sub">고친 PSD 로 · 설정·기록은 그대로</small>
            </DropdownMenu.Item>
          )}
          {/* 잠금 — 실수로 지우지 않게 (휴지통·이미지 지우기·일괄 선택을 막음) */}
          {onHold && (
            <DropdownMenu.Item className="profile__item" onSelect={() => onHold(!held)}>
              <span className="jobs__rowmenu-ico">
                {held ? <LockOpen className="btn__ico" /> : <Lock className="btn__ico" />}
                {held ? '잠금 풀기' : '잠그기'}
              </span>
              <small className="jobs__rowmenu-sub">{held ? '다시 지우거나 일괄 선택할 수 있게' : '휴지통 · 이미지 지우기 · 일괄 선택 막기'}</small>
            </DropdownMenu.Item>
          )}
          {/* 구분선은 하나만 — 안전한 것(복제·편집·잠금)과 지우는 것(이미지 지우기·휴지통) 사이 */}
          {(copy || onEdit || onReplace || onHold || linkOf(job)) && <DropdownMenu.Separator className="profile__sep" />}
          {canDeleteImages && (
            <>
              <DropdownMenu.Item className="profile__item profile__item--out" disabled={held} onSelect={onDeleteImages}>
                <span className="jobs__rowmenu-ico">
                  <ImageOff className="btn__ico" />
                  이미지 서버에서 지우기…
                </span>
                {held && heldSub}
              </DropdownMenu.Item>
            </>
          )}
          <DropdownMenu.Item className="profile__item" disabled={held} onSelect={onTrash}>
            <span className="jobs__rowmenu-ico">
              <Trash2 className="btn__ico" />
              휴지통으로 옮기기
            </span>
            {held ? heldSub : <small className="jobs__rowmenu-sub">휴지통에서 복원 가능</small>}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** 변환 내역 거르기 막대 */
function FilterBar({ filter: f, onFilter }: { filter: JobFilter; onFilter: (f: JobFilter) => void }) {
  // 검색은 입력이 멈춘 뒤에 보낸다 (글자마다 계정을 다시 읽지 않게)
  const [q, setQ] = useState(f.q ?? '');
  const latest = useRef(f);
  latest.current = f;
  useEffect(() => {
    if (q.trim() === (latest.current.q ?? '').trim()) return;
    const t = window.setTimeout(() => onFilter({ ...latest.current, q: q.trim() || undefined }), 350);
    return () => window.clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  // 「조건 지우기」로 검색어가 빠지면 입력칸도 비운다
  useEffect(() => {
    if (!f.q) setQ('');
  }, [f.q]);
  return (
    <div className="jobs__filter" role="search" aria-label="변환 이력 거르기">
      <input className="jobs__q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="제품명·파일명·담당·메모 검색" aria-label="제품명·파일명·담당·메모 검색" />
      {/* 판매처는 한 칸에서 고른다: 고도몰(아이티켓·온코어) / 오픈마켓(플랫폼별). 값 = 채널 또는 openmarket:<플랫폼> */}
      <Select
        size="md"
        aria-label="판매처"
        value={f.channel === 'openmarket' && f.market ? `openmarket:${f.market}` : f.channel ?? ''}
        onChange={(v) => {
          const [ch, mk] = v.split(':');
          onFilter({ ...f, channel: (ch || undefined) as JobFilter['channel'], market: (mk || undefined) as Market | undefined });
        }}
        options={[
          { value: '', label: '전체 판매처' },
          {
            group: '고도몰',
            options: [
              { value: 'godo', label: '고도몰 전체' },
              { value: 'itket', label: '아이티켓' },
              { value: 'zbyhp', label: 'zbyhp' },
              { value: 'cadkorea', label: 'cadkorea' },
              { value: 'oncore', label: '온코어' },
            ],
          },
          {
            group: '오픈마켓',
            options: [{ value: 'openmarket', label: '오픈마켓 전체' }, ...(Object.keys(MARKETS) as Market[]).map((m) => ({ value: `openmarket:${m}`, label: MARKETS[m].label }))],
          },
        ]}
      />
      <Select
        size="md"
        aria-label="상태"
        value={f.state ?? ''}
        onChange={(v) => onFilter({ ...f, state: (v || undefined) as JobFilter['state'] })}
        options={[
          { value: '', label: '전체 상태' },
          { value: 'ready', label: '준비' },
          { value: 'pending', label: '대기' },
          { value: 'done', label: '완료' },
          { value: 'reg', label: '등록' },
          { value: 'problem', label: '오류·중단' },
        ]}
      />
      {/* 테스트용 작업 거르기 (작업 기록의 「테스트용 작업」) */}
      <Select
        size="md"
        aria-label="테스트 작업"
        value={f.test ?? ''}
        onChange={(v) => onFilter({ ...f, test: (v || undefined) as JobFilter['test'] })}
        options={[
          { value: '', label: '테스트 포함' },
          { value: 'hide', label: '테스트 제외' },
          { value: 'only', label: '테스트만' },
        ]}
      />
      {/* 기간 — 겉모양은 판매처·상태와 같은 선택 상자, 열면 빠른 선택 + 달력(날·기간) (2026-11-25) */}
      <PeriodPicker value={{ days: f.days, range: f.range }} onChange={(p) => onFilter({ ...f, days: p.days, range: p.range })} />
      {/* 조건 초기화 — 필터 줄 맨 오른쪽 아이콘 (2026-11-26 사용자). 거르지 않을 때는 회색. 아직 보내지 않은 검색어도 함께 비운다.
          작업 수(「조건에 맞는 N개」)는 표 위 막대(.jtable__bulk)에, 결과가 0개면 빈 안내 안의 「조건 지우기」 */}
      <TipWrap disabled={!(filterOn(f) || q.trim())} content="조건 초기화">
        <Button
          type="button"
          size="sm"
          icon
          className="jobs__reset"
          aria-label="조건 초기화"
          disabled={!(filterOn(f) || q.trim())}
          onClick={() => {
            setQ('');
            onFilter({});
          }}
        >
          <RotateCcw className="btn__ico" aria-hidden="true" />
        </Button>
      </TipWrap>
    </div>
  );
}

function progress(j: Job) {
  const i = listInfo(j);
  if (!i.secs) return j.state === 'ready' ? '만들기 전' : '계획 전';
  // 코드 생성 방식은 섹션을 따로 요청하지 않는다 (계획만 있으면 마크업을 다시 만들 수 있음)
  if (i.engine === 'code') return `섹션 ${i.secs}개`;
  return `섹션 ${i.done}/${i.secs}`;
}


/** 작업 목록 — 계정(또는 이 브라우저)에 저장돼 새로고침·다른 PC 에서도 이어서 볼 수 있다 */
export default function JobsPanel(props: Props) {
  const { filter, onFilter, currentId, busy, account, loading, onMore, onOpen, onRemove, onView, trash, trashN, onTrashOpen, onRestore, mode, onShowAll, onGoCurrent, onCopy } = props;
  const recent = mode === 'recent';
  // 최근 작업은 거르기 없이 읽은 목록의 앞 5건만 (거르기는 변환 내역 화면에서만 — App 이 화면에 따라 거르기를 빼고 읽는다)
  const jobs = recent ? props.jobs.slice(0, RECENT_COUNT) : props.jobs;
  const more = recent ? false : props.more;
  const hasMore = recent && (props.jobs.length > RECENT_COUNT || props.more);
  const filtered = !recent && filterOn(filter);
  // PSD 원본이 이 브라우저에 없는 작업: 파일 고르기 창을 띄워 같은 PSD 를 받는다
  const picker = useRef<HTMLInputElement>(null);
  const [pickFor, setPickFor] = useState<Job | null>(null);
  // 지운 직후 「되돌리기」 알림 — 휴지통을 찾아가지 않아도 바로 되돌린다 (잘못 누른 경우가 많음)
  // ids: 한 번에 옮긴 작업들 (한 줄 지우기 = 1개, 고른 작업 한꺼번에 = 여러 개) — 「되돌리기」는 모두 되돌린다
  const [removed, setRemoved] = useState<{ ids: string[]; name: string } | null>(null);
  useEffect(() => {
    if (!removed) return;
    const t = window.setTimeout(() => setRemoved(null), 10_000);
    return () => window.clearTimeout(t);
  }, [removed]);
  const nameOf = (j: Job) => j.settings.productName || j.fileName;
  /** 휴지통으로 옮기기 (확인 창을 지난 뒤) — 지운 직후 「되돌리기」 알림 */
  const trashJobs = (list: Job[]) => {
    const picked = list.filter((j) => j.id !== currentId);
    if (!picked.length) return;
    for (const j of picked) onRemove(j.id);
    setRemoved({ ids: picked.map((j) => j.id), name: picked.length === 1 ? nameOf(picked[0]) : `${nameOf(picked[0])} 외 ${picked.length - 1}개` });
    setSel(new Set());
  };
  // 휴지통 확인 창 — 「이미지 서버 파일도 지우기」(기본 꺼짐)를 고르면 이미지 지우기 창을 거쳐 휴지통으로 (2026-11-26 사용자)
  const [trashAsk, setTrashAsk] = useState<Job[] | null>(null);
  const remove = (j: Job) => setTrashAsk([j]);
  // 변환 내역 화면의 체크박스 — 고른 작업을 한꺼번에 휴지통으로 (최근 작업 목록에는 없음). 지금 열린 작업은 고를 수 없다
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    // 목록이 바뀌면(거르기·지우기·더 보기) 목록에 없는 작업은 고른 것에서 뺀다
    setSel((s) => {
      // 잠근 작업도 고른 것에서 뺀다 (고른 뒤에 잠근 경우)
      const ids = new Set(props.jobs.filter((j) => !heldOf(j)).map((j) => j.id));
      const next = new Set([...s].filter((id) => ids.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [props.jobs]);
  const toggleSel = (id: string, on: boolean) =>
    setSel((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const removeSelected = () => {
    // 잠긴 작업은 혹시 골라져 있어도 빼고 옮긴다
    const picked = props.jobs.filter((j) => sel.has(j.id) && j.id !== currentId && !heldOf(j));
    if (picked.length) setTrashAsk(picked);
  };
  // PSD 없는 작업: 공유 폴더의 「채널\제품명」에서 같은 PSD 를 찾아 바로 연다 (권한이 이미 있을 때만 읽는다).
  // 못 찾으면 줄에 「PSD 선택」이 나와 직접 고르게 한다 (파일 고르기 창은 누른 직후에만 열린다)
  const [notFound, setNotFound] = useState<string | null>(null);
  const openFromShare = async (j: Job) => {
    const f = await findSharedPsd({ channel: j.settings.channel, productName: j.settings.productName, fileName: j.fileName });
    if (f) {
      setNotFound(null);
      onOpen(j, f);
    } else setNotFound(j.id);
  };
  /** 줄 하나의 작업 단추 (열기·PSD 선택·결과 보기·작업 화면으로·지우기) — 최근 작업 목록과 변환 내역 표가 같이 쓴다 */
  /** 그 줄의 주 단추가 하는 일 — 이름 칸을 눌러도 같게. 못 누를 때(만드는 중 등)는 null */
  const openOf = (j: Job, cur: boolean): (() => void) | null => {
    if (cur) return onGoCurrent ?? null;
    if (busy) return null;
    if (!j.noFile) return () => onOpen(j);
    if (listInfo(j).html) return () => onView(j);
    return () => void openFromShare(j);
  };
  const acts = (j: Job, cur: boolean) => (
        <span className="jobs__acts">
          {cur ? (
            // 변환 내역 화면에서는 열린 작업으로 돌아갈 길이 있어야 한다 (만들기 화면에 그대로 열려 있음)
            onGoCurrent ? (
              <Button type="button" size="sm" variant="primary" onClick={onGoCurrent}>
                작업 화면으로
              </Button>
            ) : (
              <span className="jobs__cur">열려 있음</span>
            )
          ) : (
            j.noFile ? (
              <>
              {listInfo(j).html && (
                // 저장된 HTML 이 있으면 PSD 없이도 연다 — 이미지가 서버에 다 있으면 복사·붙여넣기로 끝 (2026-11-25)
                <TipWrap disabled={busy} content="PSD 없이 저장된 결과를 엽니다 — 이미지가 서버에 다 있는지 확인한 뒤 HTML을 복사할 수 있습니다.">
                <Button size="sm" variant="soft" disabled={busy} onClick={() => onView(j)}>
                  {busy && <span className="spinner" aria-hidden="true" />}
                  열기
                </Button>
                </TipWrap>
              )}
              {!listInfo(j).html && (
                <TipWrap disabled={busy} content={`공유 폴더(${PSD_DIR})에서 같은 PSD를 찾아 이어서 엽니다. 없으면 「PSD 선택」으로 고를 수 있습니다.`}>
                  <Button size="sm" variant="soft" disabled={busy} onClick={() => void openFromShare(j)}>
                    {busy && <span className="spinner" aria-hidden="true" />}
                    열기
                  </Button>
                </TipWrap>
              )}
              {!listInfo(j).html && notFound === j.id && (
                <Button size="sm" disabled={busy} onClick={() => { setPickFor(j); picker.current?.click(); }}>
                  PSD 선택
                </Button>
              )}
              </>
            ) : (
              <Button size="sm" variant="soft" disabled={busy} onClick={() => onOpen(j)}>
                {/* 만드는 중·여는 중이라 못 누를 때는 왼쪽에 도는 표시 — 멈춘 게 아니라 기다리는 중임을 알린다 */}
                {busy && <span className="spinner" aria-hidden="true" />}
                열기
              </Button>
            )
          )}
          {/* 줄 끝 「⋯」 — 이미지 서버에서 지우기 · 휴지통으로 옮기기 (2026-11-25: 지우는 동작을 한곳에 모음) */}
          <RowMenu
            job={j}
            locked={busy && cur}
            held={heldOf(j)}
            // 잠금은 작업 기록(note.locked)에 저장 — 작업 정보 편집과 같은 저장 길
            onHold={props.onEditInfo && ((on) => void props.onEditInfo!(j, { ...(j.note ?? {}), locked: on }).catch((e) => console.warn('[jobs] 잠금 저장 실패', e)))}
            copy={onCopy && j.settings?.channel ? <CopySub job={j} all={props.jobs} busy={busy} onCopy={onCopy} /> : undefined} canDeleteImages={!!props.imageServer && listInfo(j).html} onEdit={props.onEditInfo && (() => setInfoFor(j))} onReplace={props.onReplace && !busy ? () => { setSwapFor(j); swapPicker.current?.click(); } : undefined} onDeleteImages={() => setImgDel([j])} onTrash={() => remove(j)} />
        </span>
  );
  // 이미지 서버에서 지울 작업 — 줄 메뉴는 1개, 고른 작업 일괄은 여러 개 (같은 확인 창)
  const [imgDel, setImgDel] = useState<Job[] | null>(null);
  // 이미지 지우기 창을 휴지통 확인 창에서 열었으면 — 다 지운 뒤 휴지통으로 옮긴다
  const [imgThenTrash, setImgThenTrash] = useState(false);
  const [infoFor, setInfoFor] = useState<Job | null>(null);
  // 「PSD 교체」: 파일 고르기 → 확인 창 → onReplace
  const swapPicker = useRef<HTMLInputElement>(null);
  const [swapFor, setSwapFor] = useState<Job | null>(null);
  const [swapFile, setSwapFile] = useState<File | null>(null);
  // 변환 내역 표 정렬 (읽어 온 작업 안에서) — 기본 최근 순. 날짜는 묶음 줄 대신 날짜 칸에 (오늘 12:16 pm · 2026.11.25)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'time', dir: -1 });
  const rows = recent || (sort.key === 'time' && sort.dir === -1) ? jobs : [...jobs].sort((x, y) => sortCmp(sort.key, x, y) * sort.dir);
  if (trash && !recent) return <TrashView {...props} trash={trash} />;
  // 최근 작업은 비면 숨기고, 변환 내역 화면은 비어 있어도 그린다 (안내 글)
  if (recent && !jobs.length && !loading) return null;

  return (
    <section className={`panel jobs${recent ? ' jobs--recent' : ''}`}>
      <ImageDeleteDialog
        jobs={imgDel}
        onChanged={props.onRefresh}
        onClose={() => {
          setImgDel(null);
          setImgThenTrash(false);
        }}
        after={
          imgThenTrash && imgDel
            ? { run: () => trashJobs(imgDel), title: '이미지 서버에서 지우고 휴지통으로', action: (n) => `${n}장 지우고 휴지통으로`, only: '휴지통으로만 옮기기', done: '작업은 휴지통으로 옮겼습니다 — 휴지통에서 되돌려도 지운 이미지는 돌아오지 않습니다.' }
            : undefined
        }
      />
      <TrashDialog
        jobs={trashAsk}
        canImages={!!props.imageServer && !!trashAsk?.some((j) => listInfo(j).html)}
        onClose={() => setTrashAsk(null)}
        onConfirm={(withImages) => {
          const list = trashAsk ?? [];
          setTrashAsk(null);
          if (withImages) {
            setImgThenTrash(true);
            setImgDel(list);
          } else trashJobs(list);
        }}
      />
      {props.onReplace && (
        <ReplacePsdDialog
          file={swapFile}
          jobs={swapFor ? [swapFor] : []}
          onClose={() => {
            setSwapFile(null);
            setSwapFor(null);
          }}
          onReplace={props.onReplace}
          onOpen={(j, f) => onOpen(j, f)}
        />
      )}
      {props.onEditInfo && <JobInfoDialog job={infoFor} onClose={() => setInfoFor(null)} onSave={props.onEditInfo} />}
      <div className="jobs__head">
        <h2 className="panel__title">
          {recent ? '최근 작업' : '변환 이력'}{' '}
          {!recent && <small>{account ? '내 계정에 저장 (다른 PC에서도 보임) · PSD 원본은 이 PC에만' : '이 브라우저에만 저장 · 최근 8개'}</small>}
          {loading && jobs.length > 0 && (
            <span className="jobs__loading" role="status">
              <span className="spinner" aria-hidden="true" /> 불러오는 중…
            </span>
          )}
        </h2>
        {recent && onShowAll && (
          <button type="button" className="link-btn jobs__all" onClick={onShowAll}>
            전체 보기{hasMore ? '' : ` (${jobs.length})`} <ArrowRight className="jobs__ico" aria-hidden="true" />
          </button>
        )}
        {!recent && trashN > 0 && (
          <Tip content="지운 작업 — 휴지통에서 언제든 복원할 수 있습니다">
          <Button type="button" size="sm" className="jobs__trash" onClick={onTrashOpen}>
            <Trash2 className="jobs__ico" /> 휴지통 {trashN}
          </Button>
          </Tip>
        )}
      </div>
      {/* 목록은 계정에 저장돼 어느 PC 에서나 보이지만 PSD 원본은 만든 PC 에만 있다 → 다른 PC 에선 공유 폴더의 PSD 로 연다 */}
      {!recent && account && jobs.length > 0 && (
        <p className="jobs__guide">
          <b>다른 PC에서 만든 작업 열기</b>
          <span>
            「열기」를 누르면 공유 폴더 <code>{PSD_DIR}</code>에서 PSD를 찾아 엽니다 (사내망). 없으면 「PSD 선택」으로 고르세요.
          </span>
        </p>
      )}
      {removed && (
        <p className="jobs__undo" role="status">
          <span>
            「{removed.name}」을(를) 휴지통으로 옮겼습니다 (휴지통에서 복원 가능).
          </span>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => {
              onRestore(removed.ids);
              setRemoved(null);
            }}
          >
            되돌리기
          </Button>
          <button type="button" className="jobs__undo-x" aria-label="알림 닫기" onClick={() => setRemoved(null)}>
            <X className="jobs__ico" aria-hidden="true" />
          </button>
        </p>
      )}
      {!recent && (jobs.length > 0 || filtered) && <FilterBar filter={filter} onFilter={onFilter} />}
      {/* 표 위 막대 — 늘 보인다 (2026-11-26 사용자). 왼쪽 작업 수(고르면 「N개 중 M개 선택」), 오른쪽 일괄 처리 단추는 골랐을 때 그 작업에 쓸 수 있는 것만.
          막대 높이는 단추가 있을 때와 같게 고정해 고를 때 표가 밀리지 않는다 (.jtable__bulk min-height). 선택 해제는 머리줄 체크박스로 */}
      {!recent && jobs.length > 0 && (
        <div className={`jtable__bulk${sel.size ? ' is-on' : ''}`} role="toolbar" aria-label="작업 수 · 고른 작업">
          {/* 왼쪽: 작업 수 (거른 상태면 「조건에 맞는 N개」) — 조건 초기화는 필터 줄 맨 오른쪽 아이콘 */}
          <span className="jtable__count">
            <b aria-live="polite">
              {filtered && !sel.size ? '조건에 맞는 ' : ''}
              <span className="sr-only">{filtered ? '' : '전체 작업 '}</span>
              {jobs.length}
              {more ? '+' : ''}개{sel.size > 0 && <> 중 {sel.size}개 선택</>}
            </b>
          </span>
          {/* 이미지 서버 연결이 있고, 고른 것 중 저장된 HTML 이 있는 작업이 있을 때만 (없는 작업은 확인 창에서 건너뛴다고 알림) */}
          {sel.size > 0 && props.imageServer && props.jobs.some((j) => sel.has(j.id) && listInfo(j).html) && (
            <Button type="button" size="sm" disabled={busy} onClick={() => setImgDel(props.jobs.filter((j) => sel.has(j.id) && !heldOf(j)))}>
              <ImageOff className="btn__ico" aria-hidden="true" />
              이미지 서버에서 지우기
            </Button>
          )}
          {sel.size > 0 && (
            <Button type="button" size="sm" disabled={busy} onClick={removeSelected}>
              <Trash2 className="btn__ico" aria-hidden="true" />
              휴지통으로 옮기기
            </Button>
          )}
        </div>
      )}
      {busy && jobs.length > 0 && <p className="hint jobs__busy">만드는 중에는 다른 작업을 열거나 지울 수 없습니다. 끝나면 다시 누를 수 있습니다.</p>}
      {!jobs.length && !loading && !filtered && <p className="hint jobs__empty">아직 작업이 없습니다. 「변환」에서 PSD를 올려 마크업을 만들면 여기에 쌓입니다.</p>}
      {!jobs.length && !loading && filtered && (
        <p className="hint jobs__empty">
          조건에 맞는 작업이 없습니다.{' '}
          <button type="button" className="link-btn" onClick={() => onFilter({})}>
            조건 지우기
          </button>
        </p>
      )}
      {loading && !jobs.length && (
        <ul className="jobs__list" role="status" aria-label="변환 이력 불러오는 중">
          {[0, 1, 2].map((i) => (
            // 실제 줄과 같은 칸·글자·버튼을 그대로 쓰고 글자만 감춘다 → 높이·여백·칸 너비가 실제 목록과 같다
            <li key={i} className="jobs__row jobs__row--skel" aria-hidden="true">
              <span className="jobs__name">
                <b>
                  <span className="skel">{SKEL_NAMES[i]}</span>
                </b>
                <small>
                  <span className="skel">{SKEL_NAMES[i]}.psd · 000.00MB</span>
                </small>
              </span>
              <span className="badge skel">완료</span>
              <span className="jobs__prog">
                <span className="skel">섹션 00개</span>
              </span>
              <span className="jobs__time">
                <span className="skel">00분 전</span>
              </span>
              <span className="jobs__acts">
                <span className="btn btn--sm skel">열기</span>
                <span className="btn btn--sm btn--icon skel">&nbsp;</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {/* 최근 작업(만들기 첫 화면)도 변환 내역과 같은 표 (2026-11-25 — 두 화면이 같은 칸·같은 단추로 읽히게). 최근 5건이라 정렬은 없이 최근 순 */}
      {jobs.length > 0 && (
        <div className="jtable__wrap">
          <table className="jtable">
            <thead>
              <tr>
                {!recent && (() => {
                  // 전체 고르기 — 지금 보이는 줄 중 고를 수 있는 것(열린 작업 제외)
                  const pickable = rows.filter((j) => j.id !== currentId && !heldOf(j)); // 잠긴 작업은 전체 고르기에서도 뺀다
                  const all = pickable.length > 0 && pickable.every((j) => sel.has(j.id));
                  // 메일함처럼: 아무것도 안 골랐으면 모두 고르기, 하나라도 골랐으면(일부 「–」·전체 ✓) 누르면 모두 풀기
                  const state = all ? true : sel.size > 0 ? 'indeterminate' : false;
                  return (
                    <th className="jtable__c-sel">
                      <CheckField checked={state} disabled={busy || !pickable.length} onChange={() => setSel(sel.size ? new Set() : new Set(pickable.map((j) => j.id)))}>
                        <span className="sr-only">{sel.size ? '고른 작업 모두 풀기' : '보이는 작업 모두 고르기'}</span>
                      </CheckField>
                    </th>
                  );
                })()}
                {SORT_COLS.map(([key, label, cls]) => recent ? (
                  <th key={key} className={cls}>
                    {label}
                  </th>
                ) : (
                  <th key={key} className={cls} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                    <button
                      type="button"
                      className={`jtable__sort${sort.key === key ? ' is-on' : ''}`}
                      onClick={() => setSort((v) => (v.key === key ? { key, dir: v.dir === 1 ? -1 : 1 } : { key, dir: key === 'time' ? -1 : 1 }))}
                    >
                      {label}
                      <span className="jtable__arrow" aria-hidden="true"><SortArrow dir={sort.key === key ? sort.dir : 0} /></span>
                    </button>
                  </th>
                ))}
                <th className="jtable__c-prog">섹션</th>
                <th className="jtable__c-acts"><span className="sr-only">작업</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((j) => {
                const st = stateOf(j, !!props.imageServer);
                const cur = j.id === currentId;
                return (
                  <Fragment key={j.id}>
                    <tr className={`${cur ? 'is-cur' : ''}${sel.has(j.id) ? ' is-sel' : ''}`}>
                      {!recent && (
                        <td className="jtable__c-sel">
                          {/* 지금 열린 작업은 고를 수 없다 (작업 화면에서 쓰는 중) */}
                          <CheckField checked={sel.has(j.id)} disabled={busy || cur || heldOf(j)} onChange={(on) => toggleSel(j.id, on)}>
                            <span className="sr-only">{nameOf(j)} 고르기</span>
                          </CheckField>
                        </td>
                      )}
                      <td className="jtable__c-name">
                        {(() => {
                          // 첫 줄(제품명·배지)만 누르는 자리 — 둘째 줄에 등록한 제품 링크가 있어 단추 안에 둘 수 없다 (단추 안 링크 금지)
                          const body = <NameLine j={j} />;
                          const link = linkOf(j);
                          // 이름 칸을 눌러도 그 줄의 주 단추와 같은 일 (작업 화면으로 · 열기 · PSD 선택) — 2026-11-25
                          const go = openOf(j, cur);
                          return (
                            <>
                            <Tip content={j.error}>
                              {go ? (
                                <button type="button" className="jobs__name jobs__name--go" onClick={go}>
                                  {body}
                                </button>
                              ) : (
                                <span className="jobs__name">{body}</span>
                              )}
                            </Tip>
                            {/* 둘째 줄: 파일 크기 · 등록한 제품(링크, 새 창) · 메모. 파일 이름은 제품명과 겹쳐 뺐다 — 마우스 올림 글에 남김 */}
                            <small className="jobs__sub" title={j.fileName}>
                              {fmtBytes(j.fileSize)}
                              {link && (
                                <>
                                  {' · '}
                                  <a className="jobs__reg" href={link} target="_blank" rel="noopener noreferrer" title={link}>
                                    등록한 제품
                                    <ExternalLink className="jobs__reg-ico" aria-hidden="true" />
                                  </a>
                                </>
                              )}
                              {memoOf(j) && ` · ${memoOf(j)}`}
                            </small>
                            </>
                          );
                        })()}
                      </td>
                      <td className="jtable__c-ch">{groupOf(j) || '—'}</td>
                      <td className="jtable__c-who">
                        <Tip content={whoTip(j)}>
                          <span>{whoOf(j) || '—'}</span>
                        </Tip>
                      </td>
                      <td className="jtable__c-state">
                        <Tip content={st.tip} delay={BADGE_TIP_DELAY}>
                          <span className={`badge jobs__stbadge ${st.tone ? `badge--${st.tone}` : ''}`} tabIndex={0}>
                            {st.label}
                          </span>
                        </Tip>
                      </td>
                      <td className="jtable__c-time">
                        <Tip content={`${dayHeading(j.updatedAt)} ${clock(j.updatedAt)} · ${ago(j.updatedAt)}`}>
                          <span className="jobs__time">{dateCell(j.updatedAt)}</span>
                        </Tip>
                      </td>
                      <td className="jtable__c-prog">{progress(j)}</td>
                      <td className="jtable__c-acts">{acts(j, cur)}</td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!recent && props.onPage ? (
        <Pager page={props.page ?? 0} total={props.total} size={props.pageSize ?? 20} more={more} loading={loading} onPage={props.onPage} />
      ) : (
        more && (
          <div className="jobs__more">
            <Button size="sm" disabled={loading} onClick={onMore}>
              {loading ? '불러오는 중…' : '더 보기'}
            </Button>
          </div>
        )
      )}
      <input
        ref={swapPicker}
        type="file"
        accept=".psd"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f && swapFor) setSwapFile(f);
          else setSwapFor(null);
        }}
      />
      <input
        ref={picker}
        type="file"
        accept=".psd"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f && pickFor) onOpen(pickFor, f);
          setPickFor(null);
        }}
      />
    </section>
  );
}

/**
 * 휴지통 — 변환 내역과 같은 표 (2026-11-26 사용자). 기간이 지나도 저절로 지우지 않는다.
 * 줄마다 복원 · 영구 삭제, 체크박스로 여러 개를 골라 한꺼번에. 영구 삭제는 확인 창을 거친다 —
 * 이미지 서버가 있고 결과가 있는 작업이면 이미지 지우기 창(살아 있는 작업이 쓰는 파일 제외·쇼핑몰 확인)을 거치고, 「이미지는 남기고 기록만 영구 삭제」도 고를 수 있다
 */
function TrashView({ trash, trashLoading, busy, onTrashClose, onRestore, onPurge, imageServer }: Props & { trash: Job[] }) {
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setSel((s) => {
      const ids = new Set(trash.map((j) => j.id));
      const next = new Set([...s].filter((id) => ids.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [trash]);
  const toggle = (id: string, on: boolean) =>
    setSel((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const all = trash.length > 0 && sel.size === trash.length;
  const off = busy || trashLoading;
  // 영구 삭제할 작업 — 이미지 창(이미지 서버·결과가 있을 때) 또는 간단한 확인 창
  const [purge, setPurge] = useState<Job[] | null>(null);
  const withImages = !!imageServer && !!purge?.some((j) => listInfo(j).html);
  const doPurge = (list: Job[]) => {
    onPurge(list.map((j) => j.id));
    setSel(new Set());
  };
  const after: DeleteAfter | undefined = purge
    ? {
        run: () => doPurge(purge),
        title: '영구 삭제 · 이미지 서버에서 지우기',
        action: (n) => `${n}장 지우고 영구 삭제`,
        only: '이미지는 남기고 기록만 영구 삭제',
        onlyAlways: true,
        done: '작업 기록을 영구 삭제했습니다.',
        gone: true,
        note: '휴지통에 같은 폴더를 쓰는 다른 작업이 있으면, 그 작업을 복원해도 지운 그림은 돌아오지 않습니다.',
      }
    : undefined;
  return (
    <section className="panel jobs jobs--trash">
      <ImageDeleteDialog jobs={withImages ? purge : null} onClose={() => setPurge(null)} after={after} />
      <PurgeDialog
        jobs={purge && !withImages ? purge : null}
        onClose={() => setPurge(null)}
        onConfirm={() => {
          if (purge) doPurge(purge);
          setPurge(null);
        }}
      />
      <div className="jobs__head">
        <h2 className="panel__title">
          <Trash2 className="jobs__ico" /> 휴지통 <small>영구 삭제하기 전까지 남아 있습니다</small>
          {trashLoading && (
            <span className="jobs__loading" role="status">
              <span className="spinner" aria-hidden="true" /> 불러오는 중…
            </span>
          )}
        </h2>
        <Button type="button" size="sm" onClick={onTrashClose}>
          <ArrowLeft className="btn__ico" aria-hidden="true" /> 변환 이력
        </Button>
      </div>
      {!trash.length && !trashLoading && <p className="hint jobs__empty">휴지통이 비었습니다.</p>}
      {/* 영구 삭제 = 이미지 서버 정리까지 — 누르기 전에 알 수 있게 (2026-11-26 사용자) */}
      {imageServer && trash.length > 0 && (
        <p className="jobs__trash-note" role="note">
          <b>영구 삭제하면 이미지 서버에 올린 이미지도 함께 지웁니다.</b> 지우기 전에 지울 이미지를 확인하는 창이 뜨고, 쇼핑몰 페이지가 아직 쓰고 있으면 「이미지는 남기고 기록만 영구 삭제」를 고르세요.
        </p>
      )}
      {sel.size > 0 && (
        <div className="jtable__bulk" role="toolbar" aria-label="고른 작업">
          <b>{sel.size}개 선택</b>
          <Button
            type="button"
            size="sm"
            disabled={off}
            onClick={() => {
              onRestore([...sel]);
              setSel(new Set());
            }}
          >
            <RotateCcw className="btn__ico" aria-hidden="true" />
            복원
          </Button>
          <Button type="button" size="sm" variant="danger" disabled={off} onClick={() => setPurge(trash.filter((j) => sel.has(j.id)))}>
            <Trash2 className="btn__ico" aria-hidden="true" />
            영구 삭제
          </Button>
        </div>
      )}
      {trash.length > 0 && (
        <div className="jtable__wrap">
          <table className="jtable">
            <thead>
              <tr>
                <th className="jtable__c-sel">
                  <CheckField checked={all} disabled={off} onChange={(on) => setSel(on ? new Set(trash.map((j) => j.id)) : new Set())}>
                    <span className="sr-only">모두 고르기</span>
                  </CheckField>
                </th>
                <th className="jtable__c-name">제품명</th>
                <th className="jtable__c-ch">판매처</th>
                <th className="jtable__c-time">지운 때</th>
                <th className="jtable__c-acts">
                  <span className="sr-only">작업</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {trash.map((j) => (
                <tr key={j.id} className={sel.has(j.id) ? 'is-sel' : ''}>
                  <td className="jtable__c-sel">
                    <CheckField checked={sel.has(j.id)} disabled={off} onChange={(on) => toggle(j.id, on)}>
                      <span className="sr-only">고르기</span>
                    </CheckField>
                  </td>
                  <td className="jtable__c-name">
                    <span className="jobs__name">
                      <NameLine j={j} />
                    </span>
                    <small className="jobs__sub" title={j.fileName}>
                      {j.fileName} · {fmtBytes(j.fileSize)}
                    </small>
                  </td>
                  <td className="jtable__c-ch">{groupOf(j)}</td>
                  <td className="jtable__c-time">
                    {j.deletedAt ? (
                      <Tip content={when(j.deletedAt)}>
                        <span tabIndex={0}>{ago(j.deletedAt)}</span>
                      </Tip>
                    ) : (
                      ''
                    )}
                  </td>
                  <td className="jtable__c-acts">
                    <span className="jobs__acts">
                      {/* 복원 = 주 동작(연한 파랑, 목록의 「열기」와 같은 모양) · 영구 삭제 = 보조(회색) — 확인 창을 거친다 */}
                      <Button size="sm" variant="soft" disabled={off} onClick={() => onRestore(j.id)}>
                        <RotateCcw className="btn__ico" aria-hidden="true" />
                        복원
                      </Button>
                      <Button size="sm" className="btn--warnhover" disabled={off} onClick={() => setPurge([j])} title={imageServer && listInfo(j).html ? '기록과 이미지 서버의 이미지를 함께 지웁니다 (확인 창에서 고름)' : '되돌릴 수 없습니다'}>
                        <Trash2 className="btn__ico" aria-hidden="true" />
                        영구 삭제
                      </Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** 영구 삭제 확인 (이미지 서버 정리가 필요 없을 때) — 되돌릴 수 없다 */
function PurgeDialog({ jobs, onClose, onConfirm }: { jobs: Job[] | null; onClose: () => void; onConfirm: () => void }) {
  const name = !jobs?.length ? '' : jobs.length === 1 ? jobs[0].settings.productName || jobs[0].fileName : `고른 작업 ${jobs.length}개`;
  return (
    <Dialog.Root open={!!jobs?.length} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg__overlay" />
        <Dialog.Content className="dlg">
          <Dialog.Title className="dlg__title">영구 삭제</Dialog.Title>
          <Dialog.Description className="dlg__sub">{name}</Dialog.Description>
          <p className="hint">작업 기록을 지우면 되돌릴 수 없습니다.</p>
          <div className="dlg__actions">
            <Button type="button" size="sm" variant="danger" onClick={onConfirm}>
              영구 삭제
            </Button>
            <Dialog.Close asChild>
              <Button type="button" size="sm">
                취소
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * 변환 내역 페이지 번호 — 이전 · 1 … 4 5 [6] 7 8 … 20 · 다음, 오른쪽에 「전체 N건」.
 * 전체 개수를 모르면(계정 조회 실패 등) 번호 없이 이전·다음만 (다음 = 더 있음)
 */
function Pager({ page, total, size, more, loading, onPage }: { page: number; total?: number; size: number; more: boolean; loading: boolean; onPage: (p: number) => void }) {
  const pages = total !== undefined ? Math.max(1, Math.ceil(total / size)) : undefined;
  if (pages === 1 && !more) return total ? <p className="jobs__pager jobs__pager--one"><span className="jobs__pager-n">전체 {total.toLocaleString()}건</span></p> : null;
  // 지금 페이지 앞뒤 2개 + 처음·끝, 사이가 비면 「…」
  const nums: (number | 'gap')[] = [];
  if (pages !== undefined) {
    for (let i = 0; i < pages; i++) {
      if (i === 0 || i === pages - 1 || Math.abs(i - page) <= 2) nums.push(i);
      else if (nums[nums.length - 1] !== 'gap') nums.push('gap');
    }
  }
  const hasNext = pages !== undefined ? page < pages - 1 : more;
  return (
    <nav className="jobs__pager" aria-label="변환 이력 페이지">
      <Button size="sm" disabled={loading || page === 0} onClick={() => onPage(page - 1)} aria-label="이전 페이지">
        <ArrowLeft className="btn__ico" aria-hidden="true" />
        이전
      </Button>
      {nums.map((n, i) =>
        n === 'gap' ? (
          <span key={`g${i}`} className="jobs__pager-gap" aria-hidden="true">…</span>
        ) : (
          <Button key={n} size="sm" variant={n === page ? 'soft' : undefined} aria-current={n === page ? 'page' : undefined} disabled={loading && n !== page} onClick={() => n !== page && onPage(n)}>
            {n + 1}
          </Button>
        ),
      )}
      <Button size="sm" disabled={loading || !hasNext} onClick={() => onPage(page + 1)} aria-label="다음 페이지">
        다음
        <ArrowRight className="btn__ico" aria-hidden="true" />
      </Button>
      {total !== undefined && <span className="jobs__pager-n">전체 {total.toLocaleString()}건</span>}
    </nav>
  );
}

/**
 * 휴지통으로 옮기기 확인 창 — 「이미지 서버 파일도 지우기」(기본 꺼짐). 고르면 이미지 지우기 창(같은 폴더를 쓰는 작업 제외·쇼핑몰 경고)을 거쳐 휴지통으로.
 * 작업은 휴지통에서 되돌릴 수 있지만 지운 이미지는 되돌릴 수 없다
 */
function TrashDialog({ jobs, canImages, onClose, onConfirm }: { jobs: Job[] | null; canImages: boolean; onClose: () => void; onConfirm: (withImages: boolean) => void }) {
  const [withImages, setWithImages] = useState(false);
  useEffect(() => {
    if (jobs) setWithImages(false);
  }, [jobs]);
  const name = !jobs?.length ? '' : jobs.length === 1 ? jobs[0].settings.productName || jobs[0].fileName : `고른 작업 ${jobs.length}개`;
  return (
    <Dialog.Root open={!!jobs?.length} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg__overlay" />
        <Dialog.Content className="dlg trashask">
          <Dialog.Title className="dlg__title">휴지통으로 옮기기</Dialog.Title>
          <Dialog.Description className="dlg__sub">{name}</Dialog.Description>
          <p className="hint">휴지통에서 언제든 되돌릴 수 있습니다. 영구 삭제는 휴지통에서 직접 합니다.</p>
          {canImages && (
            <div className="trashask__img">
              <CheckField checked={withImages} onChange={setWithImages}>
                이미지 서버 파일도 지우기
              </CheckField>
              <small className="hint">지운 이미지는 되돌릴 수 없고, 쇼핑몰에 붙여넣은 페이지는 그림이 빈칸이 됩니다. 다음 창에서 지울 이미지를 확인합니다.</small>
            </div>
          )}
          <div className="dlg__actions">
            <Button type="button" size="sm" variant={withImages ? 'danger' : 'primary'} onClick={() => onConfirm(withImages)}>
              {withImages ? '다음: 지울 이미지 확인' : '휴지통으로 옮기기'}
            </Button>
            <Dialog.Close asChild>
              <Button type="button" size="sm">
                취소
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
