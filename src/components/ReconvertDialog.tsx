// 「다시 변환」 확인 창 (2026-11-27) — 구조 계획부터 새로 받는다 (Claude 1회).
// 글자 위치·크기·자간은 코드가 PSD 값으로 계산해 몇 번을 돌려도 같으므로, 무엇이 마음에 안 드는지 적어야 결과가 달라진다.
// 지금 결과는 「이전 결과」로 남아 결과 화면의 「이전 결과로 되돌리기」로 비용 없이 되살릴 수 있다
import { useEffect, useState } from 'react';
import { Dialog } from 'radix-ui';
import { RefreshCw } from 'lucide-react';
import { Button } from './Button';

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (wish: string) => void;
  /** 다시 변환할 수 없는 이유 (있으면 단추를 끈다) */
  blocked?: string;
  /** 지금 결과가 수정 요청을 거친 것 — 처음부터 다시 받으면 그 수정이 빠진다 */
  revisions: number;
}

export default function ReconvertDialog({ open, onClose, onConfirm, blocked, revisions }: Props) {
  const [wish, setWish] = useState('');
  useEffect(() => {
    if (open) setWish('');
  }, [open]);
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg__overlay" />
        <Dialog.Content className="dlg reconv">
          <Dialog.Title className="dlg__title">처음부터 다시 변환</Dialog.Title>
          <Dialog.Description className="dlg__sub">구조 계획(섹션 나누기·사진 영역·이미지에 남길 글자·제목 단계)을 새로 받습니다 · Claude 1회, 약 $0.5~2</Dialog.Description>
          <label className="reconv__field">
            <span>마음에 안 드는 점 (선택)</span>
            <textarea
              rows={4}
              value={wish}
              onChange={(e) => setWish(e.target.value)}
              placeholder={'예) 메인 제목은 이미지 말고 글자로 / 섹션을 더 잘게 나눠 줘 / 두 번째 제품 사진을 사진 영역으로 빼 줘'}
            />
          </label>
          <ul className="reconv__notes">
            <li>글자 위치·크기·줄바꿈·자간은 PSD 값으로 계산해 다시 돌려도 같습니다. 적어 준 내용이 있어야 결과가 달라집니다.</li>
            <li>지금 결과는 「이전 결과」로 남습니다. 새 결과가 더 나쁘면 「이전 결과로 되돌리기」로 비용 없이 되살릴 수 있습니다.</li>
            {revisions > 0 && <li>지금 결과에 들어간 수정 요청 {revisions}회는 새 결과에 들어가지 않습니다. 필요하면 위 칸에 같이 적어 주세요.</li>}
            <li>몇 섹션만 고치려면 아래 「수정 요청」이 더 싸고, 다른 섹션은 그대로 둡니다.</li>
          </ul>
          {blocked && <p className="msg msg--error">다시 변환할 수 없는 이유: {blocked}</p>}
          <div className="dlg__actions">
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={!!blocked}
              onClick={() => {
                onConfirm(wish);
                onClose();
              }}
            >
              <RefreshCw className="btn__ico" />
              다시 변환
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
