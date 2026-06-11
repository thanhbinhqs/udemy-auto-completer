// State quản lý tiến trình học tập
const state = {
  courseId: null,
  courseTitle: '',
  lectures: [], // Danh sách các bài học trích xuất được
  enrolledCourses: [], // Danh sách khóa học đang theo học
  isRunning: false,
  isBulkRunning: false,
  isFinished: false,
  currentLog: 'Sẵn sàng...',
  completedCount: 0,
  totalCount: 0,
  progressPercent: 0
};

// Cấu hình mặc định (có thể được thay đổi trong Setting)
let config = {
  minDelay: 2,
  maxDelay: 5,
  skipQuizzes: false
};

// Hàm tải cấu hình từ chrome.storage.local
async function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get({
      minDelay: 2,
      maxDelay: 5,
      skipQuizzes: false
    }, (items) => {
      config = items;
      console.log('[Udemy Auto-Completer] Loaded config:', config);
      resolve();
    });
  });
}

// Khởi chạy khi script được tiêm vào trang web
console.log('[Udemy Auto-Completer] Content Script loaded.');
loadConfig().then(() => {
  init();
});

// Theo dõi thay đổi của trang web (Single Page App) để cập nhật Course ID nếu đổi khóa học
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    console.log('[Udemy Auto-Completer] URL changed. Re-initializing...');
    // Reset state và khởi tạo lại
    resetState();
    init();
  }
}).observe(document.body, { childList: true, subtree: true });

// Hàm reset state
function resetState() {
  state.courseId = null;
  state.courseTitle = '';
  state.lectures = [];
  state.enrolledCourses = [];
  state.isRunning = false;
  state.isBulkRunning = false;
  state.isFinished = false;
  state.currentLog = 'Sẵn sàng...';
  state.completedCount = 0;
  state.totalCount = 0;
  state.progressPercent = 0;
}

// Tìm kiếm Course ID bằng nhiều cách khác nhau để chống việc đổi tên class từ Udemy
function findCourseIdFromDOM() {
  // 1. Thử tìm bất kì phần tử nào có data-module-args chứa courseId
  const elements = document.querySelectorAll('[data-module-args]');
  for (const el of elements) {
    try {
      const argsAttr = el.getAttribute('data-module-args');
      if (argsAttr) {
        const args = JSON.parse(argsAttr);
        if (args && args.courseId) {
          const cid = Number(args.courseId);
          if (!isNaN(cid) && cid > 0) {
            return cid;
          }
        }
      }
    } catch (e) {
      // Bỏ qua lỗi parse JSON
    }
  }

  // 2. Thử tìm các selectors phổ biến trong player
  const playerSelectors = [
    '.ud-component--course-taking--app',
    '[data-module-id="course-taking"]',
    '[data-module-id="course-taking-app"]',
    '[class*="course-taking"]',
    '[class*="course-player"]'
  ];
  for (const sel of playerSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      try {
        const argsAttr = el.getAttribute('data-module-args');
        if (argsAttr) {
          const args = JSON.parse(argsAttr);
          if (args && args.courseId) {
            const cid = Number(args.courseId);
            if (!isNaN(cid) && cid > 0) {
              return cid;
            }
          }
        }
      } catch (e) {}
    }
  }

  // 3. Thử tìm data-clp-course-id trong body (landing page hoặc player wrapper)
  const bodyClpId = document.body.getAttribute('data-clp-course-id');
  if (bodyClpId) {
    const cid = Number(bodyClpId);
    if (!isNaN(cid) && cid > 0) {
      return cid;
    }
  }

  // 4. Thử quét các thẻ script trong DOM tìm courseId
  const scripts = document.querySelectorAll('script');
  for (const script of scripts) {
    const content = script.textContent;
    if (content) {
      const match = content.match(/"courseId"\s*:\s*(\d+)/) || 
                    content.match(/courseId\s*:\s*(\d+)/) ||
                    content.match(/course_id\s*:\s*(\d+)/) ||
                    content.match(/"id"\s*:\s*(\d+)\s*,\s*"_class"\s*:\s*"course"/);
      if (match) {
        const cid = Number(match[1]);
        if (!isNaN(cid) && cid > 0) {
          return cid;
        }
      }
    }
  }

  // 5. Thử tìm trong link canonical hoặc meta tag
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) {
    const href = canonical.getAttribute('href');
    if (href) {
      const match = href.match(/\/course\/(\d+)/);
      if (match) {
        const cid = Number(match[1]);
        if (!isNaN(cid) && cid > 0) {
          return cid;
        }
      }
    }
  }

  return null;
}

// Chờ cho đến khi lấy được Course ID hoặc quá thời gian
function waitForCourseId(timeout = 15000) {
  return new Promise((resolve, reject) => {
    const cid = findCourseIdFromDOM();
    if (cid) return resolve(cid);

    const startTime = Date.now();
    const interval = setInterval(() => {
      const cid = findCourseIdFromDOM();
      if (cid) {
        clearInterval(interval);
        resolve(cid);
      } else if (Date.now() - startTime > timeout) {
        clearInterval(interval);
        reject(new Error("Không tìm thấy ID khóa học từ giao diện Udemy."));
      }
    }, 500);
  });
}

// Kiểm tra trạng thái đăng nhập của người dùng qua API /users/me/
async function checkAuthStatus() {
  const headers = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest'
  };
  
  try {
    const response = await fetch('/api-2.0/users/me/', {
      method: 'GET',
      headers: headers
    });

    if (!response.ok) {
      checkAuthError(response, 'Kiểm tra phiên làm việc (Auth status check)');
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Udemy Auto-Completer] Lỗi khi kiểm tra đăng nhập:', err);
    return false;
  }
}

// Khởi tạo lấy thông tin khóa học từ DOM
async function init() {
  console.log('[Udemy Auto-Completer] Kiểm tra trạng thái đăng nhập...');
  const isLoggedIn = await checkAuthStatus();
  if (!isLoggedIn) {
    state.courseId = null;
    state.lectures = [];
    state.enrolledCourses = [];
    state.currentLog = 'Phiên làm việc hết hạn hoặc bị logout. Vui lòng đăng nhập lại Udemy!';
    broadcastState();
    return;
  }

  const isPlayerPage = location.pathname.includes('/learn/');
  
  if (!isPlayerPage) {
    console.log('[Udemy Auto-Completer] Đang ở trang ngoài player. Tiến hành tải danh sách khóa học...');
    state.courseId = null;
    state.lectures = [];
    await fetchEnrolledCourses();
    return;
  }

  console.log('[Udemy Auto-Completer] Đang chờ giao diện khóa học tải...');
  try {
    // Đợi tối đa 15 giây lấy Course ID bằng cơ chế quét thông minh đa phương thức
    state.courseId = await waitForCourseId(15000);
    console.log('[Udemy Auto-Completer] Trích xuất thành công Course ID:', state.courseId);

    // Lấy tên khóa học từ DOM sau khi đã render xong
    const titleEl = document.querySelector('[data-purpose="course-header-title"]') || 
                    document.querySelector('.cl-course-taking-header--course-title') ||
                    document.querySelector('[class*="course-title"]') ||
                    document.querySelector('h1');
    state.courseTitle = titleEl ? titleEl.textContent.trim() : document.title.split(' | ')[0];

    // Nếu tìm thấy Course ID, tiến hành tải danh sách bài học
    if (state.courseId) {
      await fetchCurriculum();
    }
  } catch (err) {
    console.warn('[Udemy Auto-Completer] Khởi tạo thất bại:', err.message);
    state.currentLog = 'Vui lòng mở trang học tập (Player) của khóa học để extension bắt đầu.';
    broadcastState();
  }
}

// Lấy danh sách khóa học của user hiện tại
async function fetchEnrolledCourses() {
  state.currentLog = 'Đang tải danh sách khóa học của bạn...';
  broadcastState();

  const csrfToken = getCsrfToken();
  const headers = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest'
  };
  if (csrfToken) {
    headers['X-Csrf-Token'] = csrfToken;
  }

  const query = `
    query enrolledCourses($page: Int!, $pageSize: MaxResultsPerPage!) {
      me {
        enrollments {
          courseEnrollments(page: $page, pageSize: $pageSize) {
            completionPercentage
            lastAccessedTime
            enrollmentTime
            archiveTime
            course {
              id
              title
              images {
                px240x135
                px480x270
              }
              urlCourseLanding
              instructors {
                id
                name
              }
            }
          }
        }
      }
    }
  `;

  try {
    const response = await fetch('/api/2024-01/graphql/', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        query: query,
        variables: {
          page: 0,
          pageSize: 100
        }
      })
    });

    if (!response.ok) {
      if (checkAuthError(response, 'Tải danh sách khóa học (Enrolled Courses)')) {
        throw new Error('AUTH_ERROR');
      }
      throw new Error(`Lỗi HTTP! Trạng thái: ${response.status}`);
    }

    const result = await response.json();
    const enrollments = result.data?.me?.enrollments?.courseEnrollments || [];
    
    state.enrolledCourses = enrollments.map(e => {
      const c = e.course;
      return {
        id: c.id,
        title: c.title,
        completionPercentage: e.completionPercentage,
        imageUrl: c.images?.px240x135 || c.images?.px480x270 || '',
        urlLanding: c.urlCourseLanding,
        instructors: c.instructors?.map(inst => inst.name).join(', ') || ''
      };
    });

    console.log('[Udemy Auto-Completer] Enrolled courses loaded:', state.enrolledCourses);
    state.currentLog = `Đã tải xong ${state.enrolledCourses.length} khóa học.`;
    broadcastState();
  } catch (err) {
    console.error('[Udemy Auto-Completer] Error loading enrolled courses:', err);
    if (err.message === 'AUTH_ERROR') {
      state.currentLog = 'Phiên làm việc hết hạn hoặc bị logout. Vui lòng đăng nhập lại Udemy!';
    } else {
      state.currentLog = 'Không thể tải danh sách khóa học của bạn.';
    }
    broadcastState();
  }
}

// Hoàn thành toàn bộ các khóa học đang theo học
async function startBulkAutoComplete() {
  if (state.isBulkRunning) return;
  state.isBulkRunning = true;
  state.isRunning = true;
  state.isFinished = false;
  
  state.currentLog = 'Bắt đầu hoàn thành toàn bộ khóa học...';
  broadcastState();

  // Tải lại danh sách khóa học trước để cập nhật tiến độ mới nhất
  await fetchEnrolledCourses();

  // Lọc ra danh sách các khóa học chưa hoàn thành (< 100%)
  const incompleteCourses = state.enrolledCourses.filter(c => Math.round(c.completionPercentage || 0) < 100);
  console.log(`[Udemy Auto-Completer] Found ${incompleteCourses.length} incomplete courses to process.`, incompleteCourses);

  for (let idx = 0; idx < incompleteCourses.length; idx++) {
    if (!state.isBulkRunning) break;

    const course = incompleteCourses[idx];
    state.courseId = course.id;
    state.courseTitle = course.title;
    
    state.currentLog = `[Khóa ${idx + 1}/${incompleteCourses.length}] Bắt đầu: ${course.title}`;
    broadcastState();

    // 1. Tải curriculum cho khóa học hiện tại
    try {
      await fetchCurriculum();
    } catch (err) {
      console.error(`[Udemy Auto-Completer] Lỗi tải curriculum cho khóa học ${course.id}:`, err);
      continue;
    }

    // 2. Tự động hoàn thành các bài học trong khóa học hiện tại
    const pendingLectures = state.lectures.filter(l => l.status === 'pending');
    console.log(`[Udemy Auto-Completer] Processing ${pendingLectures.length} pending items for ${course.title}`);

    for (let i = 0; i < pendingLectures.length; i++) {
      if (!state.isBulkRunning) break;

      const lec = pendingLectures[i];
      const targetLec = state.lectures.find(l => l.id === lec.id);
      if (targetLec) targetLec.status = 'running';

      state.currentLog = `[Khóa ${idx + 1}/${incompleteCourses.length}] ${course.title} -> Đang học: ${lec.title}`;
      broadcastState();

      const success = await markAsCompleted(lec);

      if (!state.isBulkRunning) {
        if (targetLec) targetLec.status = 'pending';
        break;
      }

      if (success) {
        if (targetLec) targetLec.status = 'done';
      } else {
        if (targetLec) targetLec.status = 'pending';
      }

      // Cập nhật lại % hoàn thành của khóa học hiện tại trong danh sách enrolledCourses
      calculateProgress();
      const currentCourseInList = state.enrolledCourses.find(c => c.id === course.id);
      if (currentCourseInList) {
        currentCourseInList.completionPercentage = state.progressPercent;
      }
      broadcastState();

      // Delay an toàn giữa các bài học
      if (i < pendingLectures.length - 1 && state.isBulkRunning) {
        const minMs = Math.round(config.minDelay * 1000);
        const maxMs = Math.round(config.maxDelay * 1000);
        const randomDelay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;

        if (randomDelay < 1000) {
          await sleep(randomDelay);
        } else {
          const seconds = Math.floor(randomDelay / 1000);
          const msPart = randomDelay % 1000;
          for (let sec = seconds; sec > 0; sec--) {
            if (!state.isBulkRunning) break;
            state.currentLog = `[Khóa ${idx + 1}/${incompleteCourses.length}] ${course.title} -> Chờ ${sec} giây để an toàn...`;
            broadcastState();
            await sleep(1000);
          }
          if (state.isBulkRunning && msPart > 0) {
            await sleep(msPart);
          }
        }
      }
    }

    // Sau khi kết thúc một khóa học, nghỉ 5 giây trước khi sang khóa học tiếp theo để tránh spam
    if (idx < incompleteCourses.length - 1 && state.isBulkRunning) {
      for (let sec = 5; sec > 0; sec--) {
        if (!state.isBulkRunning) break;
        state.currentLog = `Đã xong khóa học! Chuyển sang khóa học sau trong ${sec} giây...`;
        broadcastState();
        await sleep(1000);
      }
    }
  }

  const wasInterrupted = !state.isBulkRunning;
  state.isBulkRunning = false;
  state.isRunning = false;
  state.courseId = null; // Reset courseId player tạm thời
  state.lectures = [];

  // Tải lại danh sách khóa học lần cuối để cập nhật trạng thái chuẩn xác từ API
  await fetchEnrolledCourses();

  if (wasInterrupted) {
    state.currentLog = 'Đã tạm dừng hoàn thành hàng loạt.';
  } else {
    state.currentLog = 'Hoàn thành toàn bộ các khóa học!';
  }
  broadcastState();
}

// Lấy danh sách bài học (Curriculum) từ API Udemy
async function fetchCurriculum() {
  if (!state.courseId) return;

  state.currentLog = 'Đang tải danh sách bài học từ Udemy...';
  broadcastState();

  try {
    // 1. Tải danh sách cấu trúc khóa học (Curriculum) - Thử với bộ lọc tối giản
    let items = [];
    const urlWithFields = `/api-2.0/courses/${state.courseId}/subscriber-curriculum-items/?page_size=1400&fields[lecture]=title,object_index&fields[quiz]=title,object_index&fields[practice]=title,object_index&fields[chapter]=title,object_index`;
    const urlBackup = `/api-2.0/courses/${state.courseId}/subscriber-curriculum-items/?page_size=1400`;

    let response = await fetch(urlWithFields, {
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });

    if (!response.ok) {
      if (checkAuthError(response, 'Tải danh sách bài học (Curriculum) - Lần 1')) {
        throw new Error('AUTH_ERROR');
      }
      console.warn('[Udemy Auto-Completer] Fetch với bộ lọc thất bại, đang thử gọi API dự phòng không lọc...');
      response = await fetch(urlBackup, {
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
    }

    if (!response.ok) {
      if (checkAuthError(response, 'Tải danh sách bài học (Curriculum) - Lần 2')) {
        throw new Error('AUTH_ERROR');
      }
      throw new Error(`Lỗi HTTP! Trạng thái: ${response.status}`);
    }

    const data = await response.json();
    items = data.results || [];

    // 2. Tải danh sách bài học đã hoàn thành (từ API progress) làm nguồn xác thực chuẩn của Udemy
    let completedIds = new Set();
    try {
      const progressUrl = `/api-2.0/users/me/subscribed-courses/${state.courseId}/progress/?fields[course]=completed_lecture_ids,completed_quiz_ids`;
      const progressResponse = await fetch(progressUrl, {
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        }
      });

      if (progressResponse.ok) {
        const progressData = await progressResponse.json();
        
        // Trích xuất các ID bài giảng đã xong
        if (progressData.completed_lecture_ids && Array.isArray(progressData.completed_lecture_ids)) {
          progressData.completed_lecture_ids.forEach(id => completedIds.add(Number(id)));
        }
        
        // Trích xuất các ID trắc nghiệm đã xong
        if (progressData.completed_quiz_ids && Array.isArray(progressData.completed_quiz_ids)) {
          progressData.completed_quiz_ids.forEach(id => completedIds.add(Number(id)));
        }
        
        console.log('[Udemy Auto-Completer] Loaded completed IDs from progress API:', Array.from(completedIds));
      } else {
        if (checkAuthError(progressResponse, 'Tải danh sách bài đã học (Progress API)')) {
          throw new Error('AUTH_ERROR');
        }
      }
    } catch (e) {
      console.warn('[Udemy Auto-Completer] Failed to fetch progress API, fallback to curriculum info:', e);
    }

    // 3. Lọc và ánh xạ các bài học cùng chương mục, đối chiếu trạng thái hoàn thành chính xác
    state.lectures = items
      .filter(item => {
        const allowedTypes = ['chapter', 'lecture'];
        if (!config.skipQuizzes) {
          allowedTypes.push('quiz', 'practice');
        }
        return allowedTypes.includes(item._class);
      })
      .map(item => {
        const itemId = Number(item.id);
        const progress = item.learning_progress;
        
        // Kiểm tra nếu ID nằm trong danh sách hoàn thành (completed-lectures) hoặc có cờ is_completed trên curriculum
        const isLecCompleted = completedIds.has(itemId) || 
                               (progress && progress.is_completed === true) || 
                               item.is_completed === true;

        return {
          id: itemId,
          title: item.title,
          type: item._class,
          status: item._class === 'chapter' ? '' : (isLecCompleted ? 'done' : 'pending')
        };
      });

    calculateProgress();
    // Đếm số lượng bài học thực tế (không tính chương) để in log
    const actualLecturesCount = state.lectures.filter(l => l.type !== 'chapter').length;
    state.currentLog = `Tải thành công ${actualLecturesCount} bài học.`;
    broadcastState();
  } catch (err) {
    console.error('[Udemy Auto-Completer] Error fetching curriculum:', err);
    if (err.message === 'AUTH_ERROR') {
      state.currentLog = 'Phiên làm việc hết hạn hoặc bị logout. Vui lòng đăng nhập lại Udemy!';
    } else {
      state.currentLog = 'Không thể tải danh sách bài học. Hãy F5 lại trang.';
    }
    broadcastState();
  }
}

// Tính toán phần trăm tiến độ
function calculateProgress() {
  const actualLectures = state.lectures.filter(l => l.type !== 'chapter');
  state.totalCount = actualLectures.length;
  state.completedCount = actualLectures.filter(l => l.status === 'done').length;
  
  if (state.totalCount > 0) {
    state.progressPercent = (state.completedCount / state.totalCount) * 100;
  } else {
    state.progressPercent = 0;
  }
}

// Hàm Sleep/Delay giả lập thời gian nghỉ
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Kiểm tra lỗi xác thực (401/403) và in log chi tiết ra console để dễ debug
function checkAuthError(response, contextMessage) {
  if (response.status === 401 || response.status === 403) {
    console.error(`%c[Udemy Auto-Completer] PHÁT HIỆN LỖI XÁC THỰC (${response.status}) tại: ${contextMessage}`, 'color: #ef4444; font-weight: bold; font-size: 13px;');
    console.error('Chi tiết HTTP Response:', {
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      headers: Array.from(response.headers.entries())
    });

    // Clone response để đọc nội dung body mà không tiêu thụ stream chính
    response.clone().text().then(text => {
      console.error('Nội dung phản hồi từ Udemy (Response Body - 1000 kí tự đầu):');
      console.log(text.slice(0, 1000));
    }).catch(err => {
      console.error('Không thể đọc nội dung Response Body:', err);
    });

    state.currentLog = 'Phiên làm việc hết hạn hoặc bị logout. Vui lòng đăng nhập lại Udemy!';
    state.isRunning = false; // Tự động dừng vòng lặp nếu lỗi đăng nhập/hết hạn token
    broadcastState();
    return true;
  }
  return false;
}

// Tự động giải toàn bộ câu hỏi trắc nghiệm/thực hành của quiz thông qua API GraphQL
async function solveQuiz(quizId) {
  const csrfToken = getCsrfToken();
  const headers = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest'
  };
  if (csrfToken) {
    headers['X-Csrf-Token'] = csrfToken;
  }

  const queryGetQuiz = `
  query GetQuizItems($quizId: ID!, $pageSize: MaxResultsPerPage, $page: NonNegativeInt) {
    quizItemSearch(quizId: $quizId, pageSize: $pageSize, page: $page) {
      items {
        id
        __typename
        ... on MultipleChoiceQuizItem {
          id
          text
          options {
            id
            text
          }
          correctOption {
            id
            text
          }
        }
        ... on MultiSelectQuizItem {
          id
          text
          options {
            id
            text
          }
          correctOptions {
            id
            text
          }
        }
        ... on FillInTheBlanksQuizItem {
          id
          text
          correctAnswers
        }
      }
      page
      pageCount
    }
  }
  `;

  const mutationStart = `
  mutation QuizAttemptStart($quizId: ID = "") {
    quizAttemptStart(quizId: $quizId) {
      startTime
      id
    }
  }
  `;

  const mutationSubmit = `
  mutation QuizItemResponseSubmit($itemResponse: QuizItemResponseSubmitInput = {quizId: "", itemId: "", attemptId: "", durationInSeconds: 10, selectedOptionIds: ""}) {
    quizItemResponseSubmit(itemResponse: $itemResponse) {
      status
    }
  }
  `;

  const mutationComplete = `
  mutation QuizAttemptComplete($quizAttemptId: ID = "", $quizId: ID = "") {
    quizAttemptComplete(quizAttemptId: $quizAttemptId, quizId: $quizId) {
      hasMetPassingScore
      id
    }
  }
  `;

  try {
    // 1. Gửi lệnh bắt đầu làm bài trắc nghiệm (QuizAttemptStart) để lấy attemptId từ Udemy
    console.log(`[Udemy Auto-Completer] Khởi tạo làm bài trắc nghiệm cho quiz: ${quizId}`);
    const startResponse = await fetch('/api/2024-01/graphql/', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        query: mutationStart,
        variables: {
          quizId: String(quizId)
        }
      })
    });

    if (!startResponse.ok) {
      checkAuthError(startResponse, 'Khởi tạo làm bài trắc nghiệm (QuizAttemptStart)');
      throw new Error(`Không thể khởi tạo làm bài trắc nghiệm: ${startResponse.status}`);
    }

    const startResult = await startResponse.json();
    const attemptIdStr = startResult.data?.quizAttemptStart?.id;
    if (!attemptIdStr) {
      throw new Error('Không lấy được attemptId từ hệ thống Udemy.');
    }

    // Cast attemptId thành Number
    const attemptId = Number(attemptIdStr);
    console.log(`[Udemy Auto-Completer] Khởi tạo thành công. Attempt ID thực tế: ${attemptId}`);

    // 2. Tải danh sách câu hỏi và đáp án đúng
    const getResponse = await fetch('/api/2024-01/graphql/', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        query: queryGetQuiz,
        variables: {
          quizId: Number(quizId),
          pageSize: 250,
          page: 0
        }
      })
    });

    if (!getResponse.ok) {
      checkAuthError(getResponse, 'Tải danh sách câu hỏi quiz (GetQuizItems)');
      throw new Error(`Lỗi tải danh sách câu hỏi: ${getResponse.status}`);
    }

    const getResult = await getResponse.json();
    const items = getResult.data?.quizItemSearch?.items || [];
    if (items.length === 0) {
      console.log(`[Udemy Auto-Completer] Quiz ${quizId} không có câu hỏi.`);
      return true;
    }

    console.log(`[Udemy Auto-Completer] Quiz ${quizId} có ${items.length} câu hỏi. Đang tiến hành giải...`);

    // 2. Gửi đáp án đúng cho từng câu hỏi một
    for (let i = 0; i < items.length; i++) {
      const question = items[i];
      let selectedOptionIds = [];
      let filledAnswers = [];

      if (question.__typename === 'MultipleChoiceQuizItem' && question.correctOption) {
        selectedOptionIds = [question.correctOption.id];
      } else if (question.__typename === 'MultiSelectQuizItem' && question.correctOptions) {
        selectedOptionIds = question.correctOptions.map(opt => opt.id);
      } else if (question.__typename === 'FillInTheBlanksQuizItem' && question.correctAnswers) {
        filledAnswers = question.correctAnswers;
      } else {
        // Fallback nếu không quét được đáp án đúng (chọn đại option đầu tiên)
        if (question.options && question.options.length > 0) {
          selectedOptionIds = [question.options[0].id];
        }
      }

      // Gửi mutation trả lời
      const submitResponse = await fetch('/api/2024-01/graphql/', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          query: mutationSubmit,
          variables: {
            itemResponse: {
              quizId: Number(quizId),
              itemId: question.id,
              attemptId: attemptId,
              durationInSeconds: Math.floor(Math.random() * 10) + 5, // thời gian làm bài ngẫu nhiên 5-15s
              selectedOptionIds: selectedOptionIds,
              filledAnswers: filledAnswers
            }
          }
        })
      });

      if (!submitResponse.ok) {
        checkAuthError(submitResponse, `Trả lời câu hỏi quiz (QuizItemResponseSubmit) - ID: ${question.id}`);
        console.warn(`[Udemy Auto-Completer] Lỗi trả lời câu hỏi ${question.id}`);
      } else {
        console.log(`[Udemy Auto-Completer] Đã tự động trả lời đúng câu hỏi ${i + 1}/${items.length}`);
      }

      // Delay nhẹ 1s để mô phỏng hành vi làm bài
      await sleep(1000);
    }

    // 3. Gửi lệnh hoàn thành làm bài trắc nghiệm (QuizAttemptComplete) để nộp bài
    console.log(`[Udemy Auto-Completer] Gửi lệnh hoàn thành bài thi. Attempt ID: ${attemptId}`);
    const completeResponse = await fetch('/api/2024-01/graphql/', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        query: mutationComplete,
        variables: {
          quizAttemptId: String(attemptId),
          quizId: String(quizId)
        }
      })
    });

    if (!completeResponse.ok) {
      checkAuthError(completeResponse, `Nộp bài thi trắc nghiệm (QuizAttemptComplete) - Attempt ID: ${attemptId}`);
      console.warn(`[Udemy Auto-Completer] Gửi lệnh nộp bài thi thất bại: ${completeResponse.status}`);
    } else {
      console.log(`[Udemy Auto-Completer] Đã nộp bài thi thành công.`);
    }

    return true;
  } catch (err) {
    console.error(`[Udemy Auto-Completer] Không thể tự giải quiz ${quizId}:`, err);
    return false;
  }
}

// Đánh dấu hoàn thành một bài học cụ thể
async function markAsCompleted(lec) {
  const csrfToken = getCsrfToken();
  const headers = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest'
  };
  
  if (csrfToken) {
    headers['X-Csrf-Token'] = csrfToken;
  }

  // Đối với bài giảng thông thường (lecture), sử dụng đúng API thực tế
  if (lec.type === 'lecture') {
    const url = `/api-2.0/users/me/subscribed-courses/${state.courseId}/completed-lectures/`;
    const body = {
      lecture_id: Number(lec.id),
      downloaded: false
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        checkAuthError(response, `Hoàn thành bài giảng: ${lec.title} (ID: ${lec.id})`);
      }
      return response.ok;
    } catch (err) {
      console.error(`[Udemy Auto-Completer] Error completing lecture ${lec.id}:`, err);
      return false;
    }
  } else {
    // Đối với Trắc nghiệm (quiz) hoặc Thực hành (practice)
    // 1. Tự động giải toàn bộ câu hỏi trắc nghiệm của quiz (bao gồm cả nộp bài)
    state.currentLog = `Đang giải tự động các câu hỏi: ${lec.title}`;
    broadcastState();
    
    const quizSolved = await solveQuiz(lec.id);
    if (quizSolved) {
      return true;
    }
    
    // Nếu giải lỗi, thử nghiệm fallback gọi progress-logs trực tiếp như giải pháp dự phòng
    console.warn(`[Udemy Auto-Completer] Không thể giải tự động quiz ${lec.id}, thử mark complete trực tiếp.`);
    const url = `/api-2.0/users/me/subscribed-courses/${state.courseId}/quizzes/${lec.id}/progress-logs/`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ status: 1 })
      });

      if (response.ok) return true;
      checkAuthError(response, `Fallback hoàn thành quiz progress-logs: ${lec.title} (ID: ${lec.id})`);

      const altUrl = `/api-2.0/users/me/subscribed-courses/${state.courseId}/practice-tests/${lec.id}/progress-logs/`;
      const altResponse = await fetch(altUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ status: 1 })
      });
      if (!altResponse.ok) {
        checkAuthError(altResponse, `Fallback hoàn thành practice progress-logs: ${lec.title} (ID: ${lec.id})`);
      }
      return altResponse.ok;
    } catch (err) {
      console.error(`[Udemy Auto-Completer] Error completing quiz/practice ${lec.id} via fallback:`, err);
      return false;
    }
  }
}

// Bắt đầu vòng lặp tự động hoàn thành khóa học
async function startAutoComplete() {
  if (state.isRunning) return;
  state.isRunning = true;
  state.isFinished = false;
  state.currentLog = 'Bắt đầu xử lý danh sách bài học chưa học...';
  broadcastState();

  const pendingLectures = state.lectures.filter(l => l.status === 'pending');
  console.log(`[Udemy Auto-Completer] Found ${pendingLectures.length} pending items to complete.`);

  for (let i = 0; i < pendingLectures.length; i++) {
    // Nếu trong lúc chạy bị thay đổi trạng thái dừng (mặc dù hiện tại extension này chạy liên tục)
    if (!state.isRunning) break;

    const lec = pendingLectures[i];
    
    // Cập nhật trạng thái bài học đang chạy
    const targetLec = state.lectures.find(l => l.id === lec.id);
    if (targetLec) targetLec.status = 'running';
    
    state.currentLog = `Đang hoàn thành: ${lec.title}`;
    broadcastState();

    const success = await markAsCompleted(lec);

    if (!state.isRunning) {
      if (targetLec) targetLec.status = 'pending';
      break;
    }

    if (success) {
      if (targetLec) targetLec.status = 'done';
      state.currentLog = `Đã xong: ${lec.title}`;
    } else {
      if (targetLec) targetLec.status = 'pending';
      state.currentLog = `Lỗi hoặc bỏ qua bài: ${lec.title}`;
      console.warn(`[Udemy Auto-Completer] Failed to mark item ${lec.id} completed.`);
    }

    calculateProgress();
    broadcastState();

    // Thực hiện nghỉ ngẫu nhiên tránh rate limit của Udemy theo cấu hình thiết lập
    if (i < pendingLectures.length - 1 && state.isRunning) {
      const minMs = Math.round(config.minDelay * 1000);
      const maxMs = Math.round(config.maxDelay * 1000);
      const randomDelay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
      
      if (randomDelay < 1000) {
        // Nếu thời gian chờ ngắn (dưới 1 giây), ngủ trực tiếp không cần đếm ngược
        state.currentLog = `Nghỉ ${(randomDelay / 1000).toFixed(1)} giây...`;
        broadcastState();
        await sleep(randomDelay);
      } else {
        // Nếu thời gian chờ dài, thực hiện đếm ngược từng giây
        const seconds = Math.floor(randomDelay / 1000);
        const msPart = randomDelay % 1000;
        
        for (let sec = seconds; sec > 0; sec--) {
          if (!state.isRunning) break;
          state.currentLog = `Chờ ${sec} giây để an toàn...`;
          broadcastState();
          await sleep(1000);
        }
        
        if (state.isRunning && msPart > 0) {
          await sleep(msPart);
        }
      }
    }
  }

  const wasInterrupted = !state.isRunning;
  state.isRunning = false;
  
  // Tính toán lại lần cuối
  calculateProgress();
  const allDone = state.lectures.every(l => l.status === 'done');
  if (allDone) {
    state.isFinished = true;
    state.currentLog = 'Hoàn thành 100% khóa học! Hãy nhấn Tải lại trang học để cập nhật.';
  } else if (!wasInterrupted) {
    state.currentLog = 'Đã hoàn tất các bài học được xử lý.';
  }
  
  broadcastState();
  console.log('[Udemy Auto-Completer] Auto-complete finished.');
}

// Lấy CSRF token từ Cookie của trình duyệt
function getCsrfToken() {
  const match = document.cookie.match(/csrftoken=([^;]+)/);
  return match ? match[1] : '';
}

// Format dữ liệu gửi đi
function getSerializableState() {
  return {
    courseId: state.courseId,
    courseTitle: state.courseTitle,
    lectures: state.lectures,
    enrolledCourses: state.enrolledCourses,
    completedCount: state.completedCount,
    totalCount: state.totalCount,
    progressPercent: state.progressPercent,
    isFinished: state.isFinished,
    isRunning: state.isRunning,
    isBulkRunning: state.isBulkRunning,
    currentLog: state.currentLog
  };
}

// Gửi tin nhắn đồng bộ trạng thái về Popup UI nếu đang mở
function broadcastState() {
  chrome.runtime.sendMessage({
    action: 'STATUS_UPDATE',
    data: getSerializableState()
  }).catch(() => {
    // Lỗi này xảy ra khi Popup UI đóng (chrome.runtime.sendMessage không có receiver). 
    // Điều này là bình thường vì content script vẫn chạy ngầm dưới tab.
  });
}

// Nhận tin nhắn điều khiển từ Popup UI
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'GET_STATUS') {
    init()
      .then(() => {
        sendResponse({ success: true, data: getSerializableState() });
      })
      .catch(err => {
        sendResponse({ success: false, message: err.message });
      });
    return true; // Giữ kết nối async
  } else if (message.action === 'START') {
    if (!state.courseId || state.lectures.length === 0) {
      sendResponse({ success: false, message: 'Chưa chuẩn bị xong thông tin khóa học hoặc không tìm thấy bài học nào.' });
      return;
    }
    if (state.isRunning) {
      sendResponse({ success: false, message: 'Hệ thống đang chạy rồi.' });
      return;
    }

    // Khởi chạy tiến trình bất đồng bộ
    startAutoComplete();
    sendResponse({ success: true });
  } else if (message.action === 'STOP') {
    if (!state.isRunning) {
      sendResponse({ success: false, message: 'Không có tiến trình nào đang chạy.' });
      return;
    }

    // Gán trạng thái isRunning về false để break các vòng lặp học tập
    state.isRunning = false;
    state.currentLog = 'Đang tạm dừng tiến trình...';
    
    // Đặt lại các bài đang chạy về trạng thái chờ
    state.lectures.forEach(l => {
      if (l.status === 'running') l.status = 'pending';
    });
    
    calculateProgress();
    broadcastState();
    sendResponse({ success: true });
  } else if (message.action === 'START_BULK') {
    if (state.isBulkRunning || state.isRunning) {
      sendResponse({ success: false, message: 'Hệ thống tự học đang chạy.' });
      return;
    }
    startBulkAutoComplete();
    sendResponse({ success: true });
  } else if (message.action === 'STOP_BULK') {
    if (!state.isBulkRunning) {
      sendResponse({ success: false, message: 'Không có tiến trình hàng loạt nào đang chạy.' });
      return;
    }
    state.isBulkRunning = false;
    state.isRunning = false;
    state.currentLog = 'Đang tạm dừng hoàn thành hàng loạt...';
    broadcastState();
    sendResponse({ success: true });
  } else if (message.action === 'SETTINGS_UPDATED') {
    loadConfig().then(() => {
      // Tải lại chương trình học để áp dụng bộ lọc mới nếu có thay đổi
      if (state.courseId) {
        fetchCurriculum().then(() => {
          sendResponse({ success: true });
        });
      } else {
        sendResponse({ success: true });
      }
    });
    return true; // Giữ kết nối bất đồng bộ
  }
});
