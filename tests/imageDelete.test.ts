import { describe, expect, it } from 'vitest';
import { filesInHtml, planDelete } from '../src/lib/imageDelete';
import { deleteIn, type DeleteClient } from '../core/upload';

const BASE = 'https://itketweb.hgodo.com/data/detail/itket/zgx-nano';
const html = (...files: string[]) => files.map((f) => `<img src="${BASE}/${f}" alt="">`).join('\n');

describe('filesInHtml', () => {
  it('제품 폴더 주소의 6-1 파일명만, 중복 없이', () => {
    const h = `${html('s01_bg1.jpg', 's02_img1-hero.png', 's01_bg1.jpg')}
      <div style="background:url(${BASE}/s03_bg1.jpg)"></div>
      <img src="https://itketweb.hgodo.com/data/detail/itket/other/s01_bg1.jpg">
      <img src="${BASE}/notes.txt"> <img src="${BASE}/sub/s04_bg1.jpg">`;
    expect(filesInHtml(h, BASE)).toEqual(['s01_bg1.jpg', 's02_img1-hero.png', 's03_bg1.jpg']);
  });
  it('끝 / 가 붙은 base 도 같게', () => {
    expect(filesInHtml(html('s01_bg1.jpg'), `${BASE}/`)).toEqual(['s01_bg1.jpg']);
  });
});

describe('planDelete', () => {
  it('다른 작업도 쓰는 파일은 남긴다', () => {
    const p = planDelete(html('s01_bg1.jpg', 's02_bg1.jpg', 's03_bg1.jpg'), BASE, [
      { name: '복제본', html: html('s02_bg1.jpg') },
      { name: '다른 판', html: html('s02_bg1.jpg', 's03_bg1.jpg') },
      { name: 'HTML 없음' },
    ]);
    expect(p.del).toEqual(['s01_bg1.jpg']);
    expect(p.keep).toEqual([
      { file: 's02_bg1.jpg', by: ['복제본', '다른 판'] },
      { file: 's03_bg1.jpg', by: ['다른 판'] },
    ]);
  });
});

/** 메모리 속 가짜 FTP 폴더 */
function fakeFtp(dir: string, names: string[]) {
  const files = new Set(names.map((n) => `${dir}/${n}`));
  let dirExists = true;
  const calls: string[] = [];
  const c: DeleteClient = {
    isDir: async (p) => p === dir && dirExists,
    list: async (p, all) => [...files].filter((f) => f.startsWith(`${p}/`)).map((f) => f.slice(p.length + 1)).filter((n) => all || !n.startsWith('.')),
    size: async (p) => (files.has(p) ? 100 : null),
    remove: async (p) => {
      calls.push(`rm ${p}`);
      if (!files.delete(p)) throw new Error('없음');
    },
    rmdir: async (p) => {
      calls.push(`rmdir ${p}`);
      dirExists = false;
    },
  };
  return { c, files, calls };
}

describe('deleteIn', () => {
  const dir = '/data/detail/itket/zgx-nano';
  it('고른 파일과 그 백업·임시 파일만 지우고, 남은 파일이 있으면 폴더는 둔다', async () => {
    const f = fakeFtp(dir, ['s01_bg1.jpg', '.bak-20261120-101010-s01_bg1.jpg', '.part-s01_bg1.jpg', 's02_bg1.jpg', '.bak-20261120-101010-s02_bg1.jpg']);
    const out = await deleteIn(f.c, dir, ['s01_bg1.jpg', 's09_bg1.jpg']);
    expect(out.removed).toEqual(['s01_bg1.jpg']);
    expect(out.missing).toEqual(['s09_bg1.jpg']);
    expect(out.backups).toBe(2);
    expect(out.folderRemoved).toBe(false);
    expect([...f.files].sort()).toEqual([`${dir}/.bak-20261120-101010-s02_bg1.jpg`, `${dir}/s02_bg1.jpg`]);
  });
  it('폴더가 비면 폴더도 지운다', async () => {
    const f = fakeFtp(dir, ['s01_bg1.jpg']);
    const out = await deleteIn(f.c, dir, ['s01_bg1.jpg']);
    expect(out.folderRemoved).toBe(true);
    expect(f.calls).toContain(`rmdir ${dir}`);
  });
  it('폴더가 없으면 모두 missing', async () => {
    const f = fakeFtp('/elsewhere', []);
    const out = await deleteIn(f.c, dir, ['s01_bg1.jpg']);
    expect(out).toMatchObject({ removed: [], missing: ['s01_bg1.jpg'], folderRemoved: false });
  });
  it('백업만 못 지우면 본 파일은 removed, 백업은 backupFailed (failed 아님)', async () => {
    const f = fakeFtp(dir, ['s01_bg1.jpg', '.bak-20261120-101010-s01_bg1.jpg', 's02_bg1.jpg']);
    const realRemove = f.c.remove;
    f.c.remove = async (p) => (p.includes('.bak-') ? Promise.reject(new Error('거절')) : realRemove(p));
    const out = await deleteIn(f.c, dir, ['s01_bg1.jpg']);
    expect(out.removed).toEqual(['s01_bg1.jpg']);
    expect(out.failed).toEqual([]);
    expect(out.backupFailed).toEqual(['.bak-20261120-101010-s01_bg1.jpg']);
  });
  it('rmdir 이 실패하면 folderRemoved 는 false', async () => {
    const f = fakeFtp(dir, ['s01_bg1.jpg']);
    f.c.rmdir = async () => Promise.reject(new Error('거절'));
    const out = await deleteIn(f.c, dir, ['s01_bg1.jpg']);
    expect(out.folderRemoved).toBe(false);
  });
  it('마감이 가까우면 남은 것은 left', async () => {
    const f = fakeFtp(dir, ['s01_bg1.jpg', 's02_bg1.jpg']);
    const out = await deleteIn(f.c, dir, ['s01_bg1.jpg', 's02_bg1.jpg'], Date.now() + 10_000);
    expect(out.left).toEqual(['s01_bg1.jpg', 's02_bg1.jpg']);
    expect(out.folderRemoved).toBe(false);
    expect(f.files.size).toBe(2);
  });
});

describe('imageFolder · 오픈마켓 플랫폼 폴더 (규칙 6-1, 2026-11-25)', () => {
  it('고도몰은 <채널>/<슬러그>, 오픈마켓은 openmarket/<플랫폼>/<슬러그>', async () => {
    const { imageFolder, imageBaseUrl } = await import('../shared/types');
    expect(imageFolder({ channel: 'itket', slug: 'zgx', market: 'coupang' })).toBe('itket/zgx');
    expect(imageFolder({ channel: 'openmarket', slug: 'zgx', market: 'coupang' })).toBe('openmarket/coupang/zgx');
    expect(imageBaseUrl({ publicRoot: 'https://a.com/data/detail/', channel: 'openmarket', slug: 'zgx', market: 'st11' })).toBe('https://a.com/data/detail/openmarket/st11/zgx');
  });
  it('업로드 서버는 오픈마켓 플랫폼이 없거나 모르는 값이면 거절', async () => {
    const { checkTarget } = await import('../core/upload');
    const cfg = { host: 'h', port: 21, user: 'u', pass: 'p', root: '/data/detail', publicBase: 'https://a.com/data/detail' };
    const t = { channel: 'openmarket', slug: 'zgx', publicRoot: 'https://a.com/data/detail' };
    expect(checkTarget(cfg, t)).toMatch(/플랫폼/);
    expect(checkTarget(cfg, { ...t, market: 'toString' })).toMatch(/플랫폼/);
    expect(checkTarget(cfg, { ...t, market: 'coupang' })).toBeNull();
    expect(checkTarget(cfg, { ...t, channel: 'itket' })).toBeNull();
  });
});
