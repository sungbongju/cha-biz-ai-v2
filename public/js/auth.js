/**
 * ================================================
 * auth.js - 경영학전공 카카오 로그인 + 행동추적
 * ================================================
 *
 * 기능:
 * 1. 카카오 소셜 로그인 / 게스트 모드
 * 2. 아바타 봇에 사용자 정보 + 토큰 전달
 * 3. 섹션별 체류시간 자동 추적 (IntersectionObserver)
 * 4. 행동 로그 배치 전송 (5개마다 or 페이지 떠날 때)
 * 5. 전공 트랙 추천 연동
 * 6. 개인화 인사말용 이력 조회 (user_history)
 * ================================================
 */

(function () {
  'use strict';

  var API_BASE = 'https://aiforalab.com/business-api/api.php';
  var KAKAO_JS_KEY = 'fc0a1313d895b1956f3830e5bf14307b';
  var TOKEN_KEY = 'business_token';
  var USER_KEY = 'business_user';
  var SESSION_KEY = 'business_session';

  // ============================================
  // 1. 세션 관리
  // ============================================

  function getStoredSession() {
    try {
      var token = localStorage.getItem(TOKEN_KEY);
      var user = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
      if (token && user) return { token: token, user: user };
    } catch (e) { }
    return null;
  }

  function saveSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    if (!localStorage.getItem(SESSION_KEY)) {
      localStorage.setItem(SESSION_KEY, generateSessionId());
    }
  }

  function clearSession() {
    stopTracking();
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(SESSION_KEY);
  }

  function getSessionId() {
    var sid = localStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = generateSessionId();
      localStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  }

  function generateSessionId() {
    return 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
  }

  // ============================================
  // 2. 카카오 로그인
  // ============================================

  var _loginInProgress = false;

  function kakaoLogin() {
    if (!window.Kakao || !Kakao.isInitialized()) {
      alert('카카오 SDK가 로드되지 않았습니다. 페이지를 새로고침해주세요.');
      return;
    }

    if (_loginInProgress) {
      console.log('[Auth] 로그인 이미 진행 중');
      return;
    }
    _loginInProgress = true;

    // 기존 카카오 토큰 정리 (세션 충돌 방지)
    try {
      if (Kakao.Auth.getAccessToken()) {
        console.log('[Auth] 기존 카카오 토큰 정리');
        Kakao.Auth.setAccessToken(null);
      }
    } catch (e) { }

    // 로딩 상태 표시
    var loginBtn = document.getElementById('kakao-login-btn');
    var originalHTML = loginBtn ? loginBtn.innerHTML : '';
    if (loginBtn) {
      loginBtn.disabled = true;
      loginBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18"><path fill="#000" d="M9 1C4.58 1 1 3.79 1 7.21c0 2.17 1.45 4.08 3.64 5.18-.16.57-.58 2.07-.67 2.39-.1.39.14.39.3.28.12-.08 1.93-1.31 2.71-1.84.65.09 1.32.14 2.02.14 4.42 0 8-2.79 8-6.21C17 3.79 13.42 1 9 1z"/></svg> 인증 대기 중...';
    }

    function resetBtn() {
      _loginInProgress = false;
      if (loginBtn) {
        loginBtn.innerHTML = originalHTML;
        // consent 체크 상태에 따라 disabled 결정
        var reqBoxes = document.querySelectorAll('.consent-req:not([disabled])');
        var allReqChecked = Array.prototype.every.call(reqBoxes, function(c) { return c.checked; });
        loginBtn.disabled = !allReqChecked;
      }
    }

    // 45초 타임아웃
    var loginTimeout = setTimeout(function () {
      console.warn('[Auth] 카카오 로그인 타임아웃 (45초)');
      resetBtn();
      alert('카카오 인증이 완료되지 않았습니다.\n\n팝업 창이 열려있다면 닫아주시고,\n페이지를 새로고침 후 다시 시도해주세요.');
    }, 45000);

    // 토큰 폴링 (팝업 콜백이 실패해도 토큰이 설정되었는지 확인)
    var pollCount = 0;
    var pollTimer = setInterval(function () {
      pollCount++;
      try {
        var token = Kakao.Auth.getAccessToken();
        if (token) {
          console.log('[Auth] 토큰 폴링으로 감지 (팝업 콜백 우회)');
          clearInterval(pollTimer);
          clearTimeout(loginTimeout);
          proceedWithKakaoUser(resetBtn);
        }
      } catch (e) { }
      if (pollCount >= 90) { // 90초까지 폴링
        clearInterval(pollTimer);
      }
    }, 1000);

    console.log('[Auth] 카카오 로그인 시도...');

    Kakao.Auth.login({
      success: function (authObj) {
        clearInterval(pollTimer);
        clearTimeout(loginTimeout);
        console.log('[Auth] Kakao login success callback 정상 수신');
        proceedWithKakaoUser(resetBtn);
      },
      fail: function (err) {
        clearInterval(pollTimer);
        clearTimeout(loginTimeout);
        resetBtn();
        console.error('[Auth] Kakao login error:', err);
        var msg = '카카오 로그인에 실패했습니다.';
        if (err && err.error_description) {
          msg += '\n' + err.error_description;
        }
        alert(msg + '\n\n다시 시도해주세요.');
      }
    });
  }

  function proceedWithKakaoUser(resetBtn) {
    Kakao.API.request({
      url: '/v2/user/me',
      success: function (res) {
        if (resetBtn) resetBtn();
        console.log('[Auth] Kakao user info:', res);

        var kakaoId = String(res.id);
        var nickname = (res.properties && res.properties.nickname) ? res.properties.nickname : '사용자';
        var email = (res.kakao_account && res.kakao_account.email) ? res.kakao_account.email : null;

        sendKakaoLoginToServer(kakaoId, nickname, email);
      },
      fail: function (err) {
        if (resetBtn) resetBtn();
        console.error('[Auth] Kakao user info error:', err);
        alert('카카오 사용자 정보를 가져오지 못했습니다.\n페이지를 새로고침 후 다시 시도해주세요.');
      }
    });
  }

  function sendKakaoLoginToServer(kakaoId, nickname, email) {
    console.log('[Auth] 서버에 카카오 로그인 요청:', { kakaoId: kakaoId, nickname: nickname, email: email });

    fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'kakao_login',
        kakao_id: kakaoId,
        nickname: nickname,
        email: email
      })
    })
    .then(function (res) {
      console.log('[Auth] 서버 응답 상태:', res.status);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      console.log('[Auth] 서버 응답 데이터:', data);
      if (data.success) {
        saveSession(data.token, data.user);
        updateUI(data.user);
        sendUserInfoToAvatar(data.user, data.token);
        startTracking();

        // 로그인 모달 닫기
        var modal = document.getElementById('login-modal');
        if (modal) modal.classList.remove('active');

        console.log('[Auth] 카카오 로그인 성공:', data.user.name, '(visit:', data.user.visit_count, ')');
      } else {
        console.error('[Auth] 서버 로그인 실패:', data);
        alert('로그인 실패: ' + (data.error || '알 수 없는 오류'));
      }
    })
    .catch(function (e) {
      console.error('[Auth] Server error:', e);
      alert('서버 연결에 실패했습니다.\n잠시 후 다시 시도해주세요.\n\n오류: ' + e.message);
    });
  }

  // ============================================
  // 3. 로그아웃
  // ============================================

  function logout() {
    // 남은 로그 전송
    flushLogs(true);

    // 카카오 로그아웃 + 토큰 정리
    if (window.Kakao && Kakao.Auth) {
      try {
        if (Kakao.Auth.getAccessToken()) {
          Kakao.Auth.logout(function () {
            console.log('[Auth] Kakao logout 완료');
          });
        }
        Kakao.Auth.setAccessToken(null);
      } catch (e) {
        console.log('[Auth] Kakao logout 중 에러 (무시):', e);
      }
    }

    clearSession();
    updateUI(null);
    location.reload();
  }

  // ============================================
  // 4. UI 업데이트
  // ============================================

  function updateUI(user) {
    var topBar = document.getElementById('user-top-bar');
    var badge = document.getElementById('user-badge');

    if (user && user.name) {
      if (topBar) topBar.classList.add('show');
      if (badge) {
        var visitText = '';
        if (user.visit_count && user.visit_count > 1) {
          visitText = ' \u00b7 ' + user.visit_count + '회 방문';
        }
        badge.textContent = user.name + visitText;
      }
    } else {
      if (topBar) topBar.classList.remove('show');
    }
  }

  // ============================================
  // 5. 사용자 이력 조회 (개인화 인사말)
  // ============================================

  function fetchUserHistory(userId) {
    return fetch(API_BASE + '?action=user_history&user_id=' + userId)
      .then(function (r) {
        if (!r.ok) return null;
        return r.json();
      })
      .then(function (data) {
        if (data && data.success) return data;
        return null;
      })
      .catch(function () { return null; });
  }

  // ============================================
  // 6. 아바타에 사용자 정보 + 이력 전달
  // ============================================

  var _avatarReady = false;
  var _pendingAvatarPayload = null;
  var _userInfoSent = false;

  function sendUserInfoToAvatar(user, token) {
    var iframe = document.getElementById('heygen-pip');
    if (!iframe || !iframe.contentWindow) return;

    var tkn = token || localStorage.getItem(TOKEN_KEY);

    fetchUserHistory(user.id).then(function (history) {
      var payload = {
        type: 'USER_INFO',
        user: user,
        token: tkn,
        sessionId: getSessionId(),
        apiBase: API_BASE,
        history: history ? {
          visit_count: history.visit_count,
          recent_topics: history.recent_topics,
          interest_track: history.interest_track,
          last_visit: history.last_visit
        } : null
      };

      function trySend() {
        try {
          iframe.contentWindow.postMessage(payload, '*');
          iframe.contentWindow.postMessage({ type: 'START_AVATAR' }, '*');
          console.log('[Auth] USER_INFO 전송:', user.name);
        } catch (e) { }
      }

      if (_userInfoSent) return;
      function sendOnce() {
        if (_userInfoSent) return;
        _userInfoSent = true;
        trySend();
      }
      if (_avatarReady) {
        sendOnce();
      } else {
        _pendingAvatarPayload = { user: user, token: tkn };
        console.log('[Auth] 아바타 대기 중, 재시도 대기');
        // 5초, 10초, 18초에 시도
        setTimeout(function(){ if(!_userInfoSent) sendOnce(); }, 5000);
        setTimeout(function(){ if(!_userInfoSent) sendOnce(); }, 10000);
        setTimeout(function(){ if(!_userInfoSent) sendOnce(); }, 18000);
      }
    });
  }

  // 아바타 iframe에서 AVATAR_READY 또는 Stream ready 신호 수신
  window.addEventListener('message', function (e) {
    if (!e.data) return;
    if (e.data.type === 'AVATAR_READY' || e.data.type === 'STREAM_READY') {
      _avatarReady = true;
      console.log('[Auth] 아바타 준비 완료 신호 수신');
      if (_pendingAvatarPayload && !_userInfoSent) {
        _pendingAvatarPayload = null;
        _userInfoSent = true;
        var session = getStoredSession();
        if (session) {
          sendUserInfoToAvatar(session.user, session.token);
        }
      }
    }
  });

  // ============================================
  // 7. 포괄적 행동 추적 시스템
  // ============================================

  var sectionTimers = {};
  var logBuffer = [];
  var trackingActive = false;
  var intersectionObserver = null;

  function startTracking() {
    if (trackingActive) return;
    trackingActive = true;

    // IntersectionObserver로 섹션 가시성 감지
    if ('IntersectionObserver' in window) {
      intersectionObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var id = entry.target.id || 'unknown';

          if (entry.isIntersecting) {
            if (!sectionTimers[id]) {
              sectionTimers[id] = { startTime: 0, totalTime: 0, isVisible: false };
            }
            sectionTimers[id].startTime = Date.now();
            sectionTimers[id].isVisible = true;
          } else {
            if (sectionTimers[id] && sectionTimers[id].isVisible) {
              var elapsed = (Date.now() - sectionTimers[id].startTime) / 1000;
              sectionTimers[id].totalTime += elapsed;
              sectionTimers[id].isVisible = false;

              // 2초 이상 체류한 경우만 로그
              if (elapsed >= 2) {
                addLog('section_view', id, { duration_seconds: Math.round(elapsed) });
              }
            }
          }
        });
      }, { threshold: 0.3 });

      // section[id] 요소에 observer 부착
      var sections = document.querySelectorAll('section[id]');
      sections.forEach(function (el) {
        intersectionObserver.observe(el);
      });
    }

    // 클릭 이벤트 위임 (탭, CTA, 퀵질문)
    document.addEventListener('click', handleClick);

    // 스크롤 깊이 추적 (10% 단위)
    var maxScrollDepth = 0;
    window.addEventListener('scroll', function () {
      if (!trackingActive) return;
      var scrollable = document.body.scrollHeight - window.innerHeight;
      if (scrollable <= 0) return;
      var scrollPercent = Math.round((window.scrollY / scrollable) * 100);
      var snapped = Math.floor(scrollPercent / 10) * 10;
      if (snapped > maxScrollDepth && snapped > 0) {
        maxScrollDepth = snapped;
        addLog('scroll_depth', 'page', { depth_percent: snapped });
      }
    });

    console.log('[Auth] 행동 추적 시작');
  }

  function stopTracking() {
    trackingActive = false;
    if (intersectionObserver) {
      intersectionObserver.disconnect();
      intersectionObserver = null;
    }
    document.removeEventListener('click', handleClick);
  }

  function handleClick(e) {
    // CTA 버튼 클릭
    var ctaBtn = e.target.closest('.cta-chat, .cta-btn');
    if (ctaBtn) {
      var ctaText = ctaBtn.textContent.trim().substring(0, 50);
      var sectionEl = ctaBtn.closest('section');
      var sectionId = sectionEl ? sectionEl.id : 'unknown';
      addLog('cta_click', sectionId, { button_text: ctaText });
    }

    // 퀵 질문 버튼 클릭
    var qBtn = e.target.closest('.quick-question-btn, [data-question]');
    if (qBtn) {
      var question = qBtn.dataset.question || qBtn.textContent.trim();
      addLog('quick_question', 'avatar', { question: question.substring(0, 100) });
    }

    // 일반 버튼/탭 클릭 (CTA가 아닌 것)
    var btn = e.target.closest('button, [role="tab"], .tab-btn');
    if (btn && !ctaBtn && !qBtn) {
      var btnText = btn.textContent.trim().substring(0, 30);
      var btnSection = btn.closest('section');
      var btnSectionId = btnSection ? btnSection.id : 'unknown';
      addLog('tab_click', btnSectionId, { button_text: btnText });
    }
  }

  // ============================================
  // 8. 로그 버퍼 + 배치 전송
  // ============================================

  function addLog(eventType, sectionId, metadata) {
    logBuffer.push({
      event_type: eventType,
      section_id: sectionId,
      session_id: getSessionId(),
      metadata: metadata,
      timestamp: new Date().toISOString()
    });

    // 5개 모이면 전송
    if (logBuffer.length >= 5) {
      flushLogs(false);
    }
  }

  function flushLogs(useBeacon) {
    if (logBuffer.length === 0) return;

    var session = getStoredSession();
    if (!session) return;

    var logsToSend = logBuffer.slice();
    logBuffer = [];

    var payload = JSON.stringify({
      action: 'log_batch',
      token: session.token,
      session_id: getSessionId(),
      events: logsToSend
    });

    if (useBeacon && navigator.sendBeacon) {
      var blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(API_BASE, blob);
      console.log('[Auth] 로그 배치 전송 (beacon):', logsToSend.length + '건');
    } else {
      fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }).catch(function () { });
      console.log('[Auth] 로그 배치 전송 (fetch):', logsToSend.length + '건');
    }
  }

  // 페이지 떠날 때 남은 로그 + 체류시간 전송
  window.addEventListener('beforeunload', function () {
    // 현재 보이는 섹션의 체류시간 마감
    Object.keys(sectionTimers).forEach(function (id) {
      if (sectionTimers[id] && sectionTimers[id].isVisible) {
        var elapsed = (Date.now() - sectionTimers[id].startTime) / 1000;
        if (elapsed >= 2) {
          addLog('section_view', id, { duration_seconds: Math.round(elapsed) });
        }
      }
    });

    // 총 페이지 체류시간
    if (window.__bizPageLoadTime) {
      var totalTime = Math.round((Date.now() - window.__bizPageLoadTime) / 1000);
      addLog('page_total', 'page', { total_seconds: totalTime });
    }

    flushLogs(true);
  });

  window.__bizPageLoadTime = Date.now();

  // ============================================
  // 9. 추천 / 예측 API
  // ============================================

  function getRecommendations() {
    var session = getStoredSession();
    if (!session) return Promise.resolve(null);

    return fetch(API_BASE + '?action=get_recommendations&token=' + session.token)
      .then(function (r) { return r.json(); })
      .then(function (d) { return d.success ? d : null; })
      .catch(function () { return null; });
  }

  function getPrediction() {
    var session = getStoredSession();
    if (!session) return Promise.resolve(null);

    return fetch(API_BASE + '?action=get_predict&token=' + session.token)
      .then(function (r) { return r.json(); })
      .then(function (d) { return d.success ? d : null; })
      .catch(function () { return null; });
  }

  // ============================================
  // 10. 로그인 모달 + 초기화
  // ============================================

  function setupLoginModal() {
    var modal = document.getElementById('login-modal');
    var kakaoBtn = document.getElementById('kakao-login-btn');
    var guestBtn = document.getElementById('login-guest-btn');
    var logoutBtn = document.getElementById('logout-btn');

    // 카카오 SDK 초기화
    if (window.Kakao && !Kakao.isInitialized()) {
      Kakao.init(KAKAO_JS_KEY);
      console.log('[Auth] Kakao SDK initialized:', Kakao.isInitialized());
    }

    // 카카오 로그인 버튼
    if (kakaoBtn) {
      kakaoBtn.addEventListener('click', function () {
        kakaoLogin();
      });
    }

    // 게스트 버튼
    if (guestBtn) {
      guestBtn.addEventListener('click', function () {
        if (modal) modal.classList.remove('active');
        console.log('[Auth] 게스트 입장');
      });
    }

    // 로그아웃 버튼
    if (logoutBtn) {
      logoutBtn.addEventListener('click', logout);
    }
  }

  function init() {
    setupLoginModal();

    // 기존 세션 복원
    var session = getStoredSession();
    if (session) {
      // 토큰 유효성 검증
      fetch(API_BASE + '?action=verify&token=' + encodeURIComponent(session.token))
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.success || data.valid) {
            updateUI(session.user);
            startTracking();
            setTimeout(function () {
              sendUserInfoToAvatar(session.user, session.token);
            }, 6000);
          } else {
            clearSession();
            updateUI(null);
            console.log('[Auth] 세션 만료, 재로그인 필요');
            setTimeout(function () {
              var modal = document.getElementById('login-modal');
              if (modal) modal.classList.add('active');
            }, 1000);
          }
        })
        .catch(function () {
          // 오프라인이면 일단 세션 유지
          updateUI(session.user);
        });
    } else {
      updateUI(null);
      // 3초 후 로그인 모달 표시
      setTimeout(function () {
        var modal = document.getElementById('login-modal');
        if (modal && !getStoredSession()) {
          modal.classList.add('active');
        }
      }, 3000);
    }
  }

  // DOM 준비되면 초기화
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 전역 API 노출
  window.BizAuth = {
    kakaoLogin: kakaoLogin,
    logout: logout,
    getSession: getStoredSession,
    getRecommendations: getRecommendations,
    getPrediction: getPrediction,
    flushLogs: flushLogs
  };

})();
