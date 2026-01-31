# JOOLAB Bigdata Clean (완전 새 프로젝트)

## 기능
- 회원가입/로그인(개인정보 최소)
- 결제일 기준 30일 + 유예 7일 이후 자료 접근 차단
- CSV 업로드 → 예쁜 HTML 렌더 → 게시글 등록(관리자만)
- 수상해수상해: 거래대금/OBV 기반 Top15
- 입금확인요청 → (설정 시) 텔레그램 관리자 알림
- 관리자: 회원/미납자/결제 CRUD/요청 승인/게시글 삭제

## 구성
- `public/` : 정적 페이지
- `_worker.js` : API + 접근제어 + D1
- `schema.sql` : D1 스키마

## D1 바인딩
- binding 이름: `DB`

## 선택 환경변수
- `TELEGRAM_BOT_TOKEN`
- `ADMIN_CHAT_ID`
- `ADMIN_USER` (기본 admin)
- `ADMIN_PASS` (기본 admin)

## 관리자 계정
- 기본: admin / admin
- 로그인 후 관리자 페이지에서 비번 리셋 가능
