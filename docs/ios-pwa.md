# iOS Safari PWA 가이드

ysadmin 은 iPhone 의 "홈 화면에 추가" 로 설치하는 standalone PWA 로 주로 쓰인다.
iOS Safari 의 PWA 모드는 일반 Mobile Safari, Chrome 모바일과 동작이 미묘하게 다르고
WebKit 의 알려진 버그/제약을 자주 마주친다. 이 문서는 그동안 부딪힌 이슈와 채택한
해결책을 기록한다.

## 1. 스크롤 컨테이너는 `body` 가 아니다 (standalone 한정)

### 증상
빠르게 탭바를 다다닥 더블탭하면 상단 safe-area 영역에 공백이 생기고 안 사라진다.
Chrome / 모바일 Safari (브라우저 모드) 에서는 재현 안 됨.

### 원인
WebKit 의 알려진 sticky detach 버그.
`body` 가 스크롤 컨테이너이면서 그 자식이 `position: sticky` 일 때, 빠른 연속
터치가 momentum scroll 의 transient state 를 만들면 sticky 가 layout 기준
위치로 detach 되고 다시 viewport 기준으로 안 돌아온다. 헤더가 위로 떠 있는
상태가 영구적으로 남아 그 자리에 body 배경이 노출되는 것.

### 해결 (`public/styles.css` 의 `@media (display-mode: standalone)` 블록)
PWA 모드일 때는 `body` 를 스크롤 컨테이너에서 빼고 `main` 이 스크롤하도록 한다.
sticky 자체가 불필요해지므로 detach 버그가 원천 차단된다.

```css
@media (display-mode: standalone) {
  html, body { overflow: hidden; height: 100%; }
  body {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    overscroll-behavior: none;
  }
  .app-header {
    position: static;      /* sticky 제거 */
    flex-shrink: 0;
    padding-top: env(safe-area-inset-top);
    will-change: auto;
    transform: none;
  }
  main {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
  }
}
```

브라우저 모드(non-standalone)에서는 기존 sticky 유지 — 그쪽은 버그 없음.

### 교훈
PWA 에서 `position: sticky` + `body scroll` + `backdrop-filter` 조합은 피한다.
sticky 가 필요해 보이면 먼저 "스크롤 컨테이너를 따로 두면 정적 위치만으로 같은
효과를 낼 수 있나" 를 검토한다.

## 2. iframe 안의 third-party 쿠키는 ITP 로 차단된다

### 증상
SSO 가 켜진 타겟을 iframe 다이얼로그로 열면 핸드오프 직후 다시 로그인 화면이
뜬다. 타겟이 `Set-Cookie` 해도 iframe 안의 쿠키는 third-party 로 간주돼
ITP(Intelligent Tracking Prevention)에 의해 즉시 차단된다.

### 해결 (`public/js/targets.js`)
SSO 가 활성화된 타겟은 iframe 대신 PWA 창 자체를 top-level navigation 으로
이동시켜 first-party 쿠키로 처리한다.

```js
urlEl.addEventListener('click', (e) => {
  if (!isStandalone()) return;
  e.preventDefault();
  if (target.sso && target.sso.enabled) {
    window.location.href = `/api/targets/${target.id}/go`;
    return;
  }
  openTargetFrame(target);
});
```

### 교훈
iOS PWA 에서 인증·세션이 필요한 외부 사이트는 iframe 으로 띄우지 않는다.
top-level navigation 으로 보내거나 back-end 가 same-origin 으로 프록시한다.

## 3. iframe 닫기 + edge swipe back/forward 의 history 오염

### 증상
iframe 다이얼로그를 닫은 뒤 PWA 가 edge swipe back/forward 제스처를 활성화시켜
앱처럼 보이지 않게 된다. iframe 내부 네비게이션이 부모의 joint session history
에 누적되기 때문이다.

### 해결 (`public/js/targets.js` 의 `openTargetFrame`, `setupTargetFrameDialog`)
1. **history 센티넬**: iframe 을 열 때 `history.pushState` 로 센티넬 상태를
   push 한다. 백 제스처/버튼이 다이얼로그 닫기로 가로채진다.
2. **iframe 엘리먼트 교체**: 닫을 때 `iframe.src = 'about:blank'` 은 또 다른
   history 항목을 만들어 정리를 망가뜨린다. 대신 iframe 엘리먼트 자체를 새 빈
   것으로 교체해 browsing context 와 history 기여분을 폐기한다.
3. **history.go 로 정리**: 명시적으로 닫을 때 누적된 iframe 내부 네비게이션을
   `history.go(-steps)` 로 한꺼번에 되돌려 부모 history 오염을 막는다.

### 교훈
iOS PWA 에서 iframe 모달을 닫을 때는 `src = 'about:blank'` 가 아니라
**엘리먼트 자체 교체** 가 정답이다. history 누적은 센티넬 + 명시적
`history.go` 로 다룬다.

## 4. safe-area 와 viewport meta

### viewport meta (`public/index.html`)
```html
<meta name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1,
               user-scalable=no, viewport-fit=cover" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="theme-color" content="#0F1115" />
```

- `viewport-fit=cover` 가 있어야 `env(safe-area-inset-*)` 가 의미를 갖는다.
- `black-translucent` 로 status bar 영역까지 우리가 칠한다 (다이나믹 아일랜드
  바로 아래에 탭바).
- `theme-color` 는 PWA 의 시스템 영역 배경색.

### safe-area 패딩 규칙
- 단축 속성(`padding`, `margin`) 절대 사용 금지 — `padding-top` 만
  `env(safe-area-inset-top)` 으로 별도로 잡아야 다이나믹 아일랜드에 컨텐츠가
  안 가려진다.
- `.app-header` 의 `padding-top` 은 `calc(8px + env(safe-area-inset-top))` 가
  base, standalone 에서는 `env(safe-area-inset-top)` 만, max-width 720px 에서는
  `calc(6px + env(safe-area-inset-top))` — 미디어쿼리 cascade 순서로 결정됨.

## 5. PWA 감지

```js
function isStandalone() {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
  if (window.navigator && window.navigator.standalone === true) return true;
  return false;
}
```

`navigator.standalone` 은 iOS Safari 전용. `display-mode: standalone` 미디어
쿼리는 모던 표준. 둘 다 체크해야 iOS 모든 버전에서 동작.

## 6. 빠른 연속 터치 처리

### `.tab` 의 `touch-action: manipulation`
iOS Safari 의 더블탭 zoom 지연(300ms) 을 제거한다. 빠른 연속 탭이 zoom 시도로
해석되어 처리 지연이나 transient state 가 생기는 것을 막는다.

### same-tab early return (`public/app.js` 의 `setupTabs`)
이미 활성 상태인 탭을 다시 누르면 panel display 재토글로 reflow 가 일어난다.
`is-active` 체크로 무시한다.

### 탭 전환 시 `window.scrollTo(0, 0)`
긴 패널에서 스크롤한 상태로 짧은 패널로 가면 브라우저가 `scrollTop` 을 다음
프레임에 보정한다 (특히 `main` 이 스크롤 컨테이너인 standalone 에서는
`main.scrollTop` 으로 바꿔야 정확하지만, 현재 코드는 `window.scrollTo` 로
충분히 동작한다 — `body` 가 스크롤 안 하므로 no-op 처럼 보여도 부작용 없음).

## 7. 스크롤바 깜빡임 (native overlay scroll indicator)

### 증상
스크롤 가능한 상태에서 우측에 회색 막대가 보인다. 처음에는 momentum scroll
중에 잠깐만 보이는 줄 알았는데, 실제로 영상으로 잡아 확대해 보면 우리가
스타일링한 `::-webkit-scrollbar` thumb 가 그대로 노출돼 스크롤 내내 자리잡고
있는 경우가 많다.

### 원인 — 단순한 미디어쿼리 reset 으로는 안 잡히는 specificity 문제
첫 번째 시도는 데스크탑용 스크롤바 스타일을 unconditional 로 두고, 터치
미디어쿼리에서 `*::-webkit-scrollbar { display: none }` 으로 reset 하는
방식이었다. 그런데 `body::-webkit-scrollbar { width: 8px }` 의 특이도는
(0,0,2), `*::-webkit-scrollbar` 는 (0,0,1) 이라 — `display` 자체는 적용되어도
iOS Safari 의 `body`/`main` 같은 최상위 스크롤 컨테이너에서 `display: none`
이 ignored 되는 케이스가 보고돼 있다. 결과적으로 8px 폭 thumb 가 그대로
그려진다. 추가로 iOS 의 native overlay momentum 인디케이터도 별도 native
컴포넌트라 `::-webkit-scrollbar` 만으로는 못 잡는다.

### 해결 (`public/styles.css`)
데스크탑용 스크롤바 스타일 블록 전체를 `@media (hover: hover) and (pointer:
fine)` 로 감싸 터치기기에서는 아예 평가조차 안 되게 만든다. 이러면
specificity 충돌이 원천 차단된다.

```css
@media (hover: hover) and (pointer: fine) {
  /* body, main, .api-keys-list, .logs-list 의 스크롤바 + thumb + hover 스타일 */
}

@media (hover: none) and (pointer: coarse) {
  * { scrollbar-width: none; }
  *::-webkit-scrollbar { display: none; width: 0; height: 0; }
  main { scrollbar-gutter: auto; }
}
```

- 터치기기: 처음부터 무(none) 상태로 출발. `*` 셀렉터로 신규 스크롤
  컨테이너도 자동 커버.
- 데스크탑: 기존 얇은 반투명 스크롤바 + `scrollbar-gutter: stable` 유지.

### 교훈
`@media` reset 으로 덮으려 하지 말고, **장치별 스타일을 처음부터 분리**한다.
iOS 의 native 컴포넌트는 CSS 우선순위로 덮기 어렵고, 도식적으로 같은
selector 의 cascade 순서로만 결정되지 않는 경우가 있다. 차이가 큰 환경
(터치 vs 마우스) 에서는 미디어쿼리로 분기해서 룰셋이 서로 격리되도록 짠다.

## 8. 디버깅 체크리스트

iOS PWA 에서만 재현되고 Chrome / 모바일 Safari 브라우저 모드에서는 안 되는
이슈가 보이면:

1. **sticky 가 관련된 일인가?** PWA 의 sticky detach 버그를 의심하고 스크롤
   컨테이너 구조를 점검한다.
2. **iframe 이 관련된 일인가?** ITP / third-party 쿠키 차단을 의심한다.
   top-level navigation 으로 대체할 수 있는지 본다.
3. **history 가 관련된 일인가?** edge swipe 활성화를 의심하고 history 누적이
   부모로 새는 지점을 본다.
4. **safe-area 가 관련된 일인가?** `viewport-fit=cover` 가 있는지, `padding`
   단축 속성이 `env(safe-area-inset-*)` 를 덮어버리지 않았는지 확인한다.
5. **빠른 터치/제스처가 관련된 일인가?** `touch-action: manipulation` 으로
   기본 제스처 ambiguity 를 줄인다.
6. **스크롤바가 깜빡이는가?** native overlay indicator 라
   `::-webkit-scrollbar` 만으로는 부족 — `display:none` + `scrollbar-width:none`
   + `scrollbar-gutter:auto` 조합으로 막는다.

## 9. 원격 디버깅

- Mac Safari → Develop → [iPhone 이름] → [PWA 이름] 으로 inspector 연결 가능
- PWA 가 inspector 목록에 안 보이면 iPhone 의 설정 > Safari > 고급 > 웹
  Inspector 활성화 확인
- 콘솔, 네트워크, layout 모두 일반 페이지처럼 디버깅 가능
