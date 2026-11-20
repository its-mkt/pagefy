// 규칙 본문에서 생성에 필요 없는 부분을 빼서 보낸다 (토큰·생각 시간 절약)
// 빼는 것: 2절 폴더 구조, 3절 Photoshop MCP 절차, 6절 머리(FTP 접속·업로드 — 6-1 파일명 규칙은 남김),
//          9절 검증 절차(프로그램·사람이 함 — 끝의 "완료 보고" 양식은 남김)
// 절 번호로 찾으므로 규칙 문구가 바뀌어도 동작한다. 못 찾으면 그 부분은 그대로 둔다

interface Part {
  head: string;
  body: string;
}

function split(text: string): Part[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const parts: Part[] = [{ head: '', body: '' }];
  for (const l of lines) {
    if (/^#{2,3} /.test(l)) parts.push({ head: l, body: '' });
    else parts[parts.length - 1].body += `${l}\n`;
  }
  return parts;
}

export function trimRules(text: string): string {
  const out: string[] = [];
  for (const p of split(text)) {
    const h = p.head;
    if (/^## 2\.\s/.test(h) || /^## 3\.\s/.test(h)) {
      out.push(`${h}\n(이 서비스에서는 프로그램이 처리 — 생략)\n`);
      continue;
    }
    if (/^## 6\.\s/.test(h)) {
      out.push(`${h}\n(업로드·FTP 는 사람이 함 — 생략. HTML 안 이미지는 모두 절대 URL(https), 상대경로·base64 금지. 사진 JPG, 세로 3,000px 넘으면 나눔)\n`);
      continue;
    }
    if (/^## 9\.\s/.test(h)) {
      const i = p.body.indexOf('**완료 보고**');
      out.push(`${h}\n(검증 절차는 프로그램·사람이 함 — 생략)\n${i >= 0 ? `\n${p.body.slice(i)}` : ''}`);
      continue;
    }
    out.push(h ? `${h}\n${p.body}` : p.body);
  }
  return out.join('').replace(/\n{3,}/g, '\n\n');
}
