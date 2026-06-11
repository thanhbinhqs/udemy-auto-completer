document.addEventListener('DOMContentLoaded', async () => {
  const courseTitleEl = document.getElementById('course-title');
  const courseIdEl = document.getElementById('course-id');
  const progressPercentEl = document.getElementById('progress-percent');
  const progressBarEl = document.getElementById('progress-bar');
  const lectureListEl = document.getElementById('lecture-list');
  const listCounterEl = document.getElementById('list-counter');
  const btnStart = document.getElementById('btn-start');
  const statusTextEl = document.getElementById('status-text');
  const errorDisplayEl = document.getElementById('error-display');
  const btnStartBulk = document.getElementById('btn-start-bulk');
  const btnViewActiveCourse = document.getElementById('btn-view-active-course');
  const btnBackToCourses = document.getElementById('btn-back-to-courses');
  const btnReloadPage = document.getElementById('btn-reload-page');
  const coursesSection = document.getElementById('courses-section');
  const coursesListEl = document.getElementById('courses-list');
  const coursesCounterEl = document.getElementById('courses-counter');
  const progressSection = document.querySelector('.progress-section');
  const listSection = document.querySelector('.list-section:not(#courses-section)');
  const courseIdContainer = document.getElementById('course-id-container');

  let activeTab = null;
  let viewMode = null;
  let cachedData = null;

  // Lấy active tab hiện tại
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tabs[0];
  } catch (err) {
    showError('Không thể truy cập tab hoạt động.');
    return;
  }

  if (!activeTab || !activeTab.url.includes('samsungu.udemy.com')) {
    showError('Vui lòng mở trang học tập của Samsung Udemy (samsungu.udemy.com) để sử dụng Extension này.');
    return;
  }

  // Thiết lập Cấu hình (Settings)
  const btnSettings = document.getElementById('btn-settings');
  const settingsPanel = document.getElementById('settings-panel');
  const btnSettingsCancel = document.getElementById('btn-settings-cancel');
  const btnSettingsSave = document.getElementById('btn-settings-save');
  const cfgMinDelay = document.getElementById('cfg-min-delay');
  const cfgMaxDelay = document.getElementById('cfg-max-delay');
  const cfgSkipQuizzes = document.getElementById('cfg-skip-quizzes');

  // Mở Settings Panel
  btnSettings.addEventListener('click', () => {
    chrome.storage.local.get({
      minDelay: 2,
      maxDelay: 5,
      skipQuizzes: false
    }, (items) => {
      cfgMinDelay.value = items.minDelay;
      cfgMaxDelay.value = items.maxDelay;
      cfgSkipQuizzes.checked = items.skipQuizzes;
      settingsPanel.classList.add('open');
    });
  });

  // Hủy cấu hình
  btnSettingsCancel.addEventListener('click', () => {
    settingsPanel.classList.remove('open');
  });

  // Lưu cấu hình
  btnSettingsSave.addEventListener('click', () => {
    const minVal = parseFloat(cfgMinDelay.value);
    const maxVal = parseFloat(cfgMaxDelay.value);
    const skipVal = cfgSkipQuizzes.checked;

    if (isNaN(minVal) || minVal < 0) {
      alert('Vui lòng nhập Delay Min hợp lệ (>= 0)');
      return;
    }
    if (isNaN(maxVal) || maxVal <= minVal) {
      alert('Vui lòng nhập Delay Max hợp lệ (lớn hơn Delay Min)');
      return;
    }

    chrome.storage.local.set({
      minDelay: minVal,
      maxDelay: maxVal,
      skipQuizzes: skipVal
    }, () => {
      settingsPanel.classList.remove('open');
      statusTextEl.textContent = 'Đã cập nhật cấu hình!';
      
      // Gửi thông báo cho content script tải lại cấu hình mới
      if (activeTab) {
        chrome.tabs.sendMessage(activeTab.id, { action: 'SETTINGS_UPDATED' }, (response) => {
          // Bỏ qua nếu có lỗi gửi tin nhắn
        });
      }
    });
  });

  // Đăng ký sự kiện Click nút bấm tải lại trang ngay (khi hết hạn phiên)
  if (btnReloadPage) {
    btnReloadPage.addEventListener('click', () => {
      if (!activeTab) return;
      statusTextEl.textContent = 'Đang tải lại trang...';
      chrome.tabs.reload(activeTab.id, {}, () => {
        window.close(); // Đóng popup sau khi F5 tab
      });
    });
  }

  // Kết nối và lấy trạng thái từ Content Script
  initConnection();

  // Đăng ký sự kiện Click nút bấm điều khiển (Bắt đầu / Tạm dừng / Tải lại)
  btnStart.addEventListener('click', () => {
    if (!activeTab) return;
    
    const currentAction = btnStart.getAttribute('data-action');
    
    if (currentAction === 'reload') {
      statusTextEl.textContent = 'Đang tải lại trang...';
      chrome.tabs.reload(activeTab.id, {}, () => {
        window.close(); // Đóng popup sau khi F5 tab học
      });
      return;
    }

    btnStart.disabled = true;

    if (currentAction === 'stop') {
      statusTextEl.textContent = 'Đang yêu cầu tạm dừng...';
      chrome.tabs.sendMessage(activeTab.id, { action: 'STOP' }, (response) => {
        if (chrome.runtime.lastError) {
          showError('Không thể gửi lệnh dừng. Vui lòng tải lại trang khóa học.');
          btnStart.disabled = false;
          return;
        }
        if (response && response.success) {
          statusTextEl.textContent = 'Đang tạm dừng...';
        } else {
          showError(response?.message || 'Có lỗi xảy ra khi dừng.');
          btnStart.disabled = false;
        }
      });
    } else {
      statusTextEl.textContent = 'Đang gửi lệnh bắt đầu...';
      chrome.tabs.sendMessage(activeTab.id, { action: 'START' }, (response) => {
        if (chrome.runtime.lastError) {
          showError('Không thể gửi lệnh đến trang Udemy. Vui lòng tải lại trang khóa học.');
          btnStart.disabled = false;
          return;
        }
        if (response && response.success) {
          statusTextEl.textContent = 'Đã bắt đầu tiến trình...';
        } else {
          showError(response?.message || 'Có lỗi xảy ra khi bắt đầu.');
          btnStart.disabled = false;
        }
      });
    }
  });

  // Đăng ký sự kiện Click nút bấm hoàn thành hàng loạt (Bắt đầu / Tạm dừng hoàn thành toàn bộ)
  if (btnStartBulk) {
    btnStartBulk.addEventListener('click', () => {
      if (!activeTab) return;

      const currentAction = btnStartBulk.getAttribute('data-action');
      btnStartBulk.disabled = true;

      if (currentAction === 'stop-bulk') {
        statusTextEl.textContent = 'Đang yêu cầu dừng chạy hàng loạt...';
        chrome.tabs.sendMessage(activeTab.id, { action: 'STOP_BULK' }, (response) => {
          if (chrome.runtime.lastError) {
            showError('Không thể gửi lệnh dừng. Vui lòng tải lại trang.');
            btnStartBulk.disabled = false;
            return;
          }
          if (response && response.success) {
            statusTextEl.textContent = 'Đang tạm dừng hàng loạt...';
          } else {
            showError(response?.message || 'Có lỗi xảy ra khi dừng.');
            btnStartBulk.disabled = false;
          }
        });
      } else {
        statusTextEl.textContent = 'Đang gửi lệnh bắt đầu chạy hàng loạt...';
        chrome.tabs.sendMessage(activeTab.id, { action: 'START_BULK' }, (response) => {
          if (chrome.runtime.lastError) {
            showError('Không thể gửi lệnh đến trang Udemy. Vui lòng tải lại trang.');
            btnStartBulk.disabled = false;
            return;
          }
          if (response && response.success) {
            statusTextEl.textContent = 'Đã bắt đầu tiến trình chạy hàng loạt...';
          } else {
            showError(response?.message || 'Có lỗi xảy ra khi bắt đầu.');
            btnStartBulk.disabled = false;
          }
        });
      }
    });
  }

  // Đăng ký sự kiện Click nút xem tiến trình của khóa đang chạy
  if (btnViewActiveCourse) {
    btnViewActiveCourse.addEventListener('click', () => {
      viewMode = 'player';
      if (cachedData) updateUI(cachedData);
    });
  }

  // Đăng ký sự kiện Click nút quay lại danh sách khóa học
  if (btnBackToCourses) {
    btnBackToCourses.addEventListener('click', () => {
      viewMode = 'courses';
      if (cachedData) updateUI(cachedData);
    });
  }

  // Lắng nghe cập nhật trạng thái thời gian thực từ Content Script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Chỉ xử lý tin nhắn từ tab hiện tại để tránh xung đột tab khác
    if (sender.tab && sender.tab.id !== activeTab.id) return;

    if (message.action === 'STATUS_UPDATE') {
      updateUI(message.data);
    }
  });

  // Gửi request lấy thông tin hiện tại từ Content Script
  function initConnection() {
    statusTextEl.textContent = 'Đang kết nối tới trang học...';
    
    chrome.tabs.sendMessage(activeTab.id, { action: 'GET_STATUS' }, (response) => {
      if (chrome.runtime.lastError) {
        // Tự động tiêm content.js nếu nó chưa được tải trước đó hoặc extension bị nạp lại
        statusTextEl.textContent = 'Đang khởi chạy tiện ích trên tab...';
        
        chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          files: ['content.js']
        }, () => {
          if (chrome.runtime.lastError) {
            showError('Không thể tự chạy mã trên tab này. Vui lòng F5 tải lại trang khóa học.');
            return;
          }
          
          // Đợi 300ms để content script tải xong và đăng ký listener rồi gửi lại tin nhắn
          setTimeout(() => {
            chrome.tabs.sendMessage(activeTab.id, { action: 'GET_STATUS' }, (retryResponse) => {
              if (chrome.runtime.lastError) {
                showError('Lỗi kết nối sau khi khởi chạy. Vui lòng F5 tải lại trang.');
                return;
              }
              if (retryResponse && retryResponse.success) {
                updateUI(retryResponse.data);
                errorDisplayEl.classList.remove('show');
              } else {
                showError(retryResponse?.message || 'Không thể lấy thông tin khóa học từ trang.');
              }
            });
          }, 300);
        });
        return;
      }

      if (response && response.success) {
        updateUI(response.data);
        errorDisplayEl.classList.remove('show');
      } else {
        showError(response?.message || 'Không thể lấy thông tin khóa học từ trang.');
      }
    });
  }

  // Cập nhật giao diện dựa trên dữ liệu trạng thái nhận được
  function updateUI(data) {
    cachedData = data;
    const {
      courseId,
      courseTitle,
      lectures,
      enrolledCourses,
      completedCount,
      totalCount,
      progressPercent,
      isFinished,
      isRunning,
      isBulkRunning,
      currentLog,
      authError
    } = data;

    // Kiểm tra trạng thái lỗi xác thực (logout/hết hạn phiên)
    if (authError) {
      // Ẩn tất cả các nút điều khiển thông thường
      if (btnStart) btnStart.style.display = 'none';
      if (btnStartBulk) btnStartBulk.style.display = 'none';
      if (btnViewActiveCourse) btnViewActiveCourse.style.display = 'none';
      if (btnBackToCourses) btnBackToCourses.style.display = 'none';
      
      // Hiển thị nút tải lại trang
      if (btnReloadPage) btnReloadPage.style.display = 'flex';
      
      // Hiển thị text log báo lỗi xác thực
      courseTitleEl.textContent = 'Phiên làm việc hết hạn';
      courseIdEl.textContent = 'Vui lòng đăng nhập lại';
      if (currentLog) statusTextEl.textContent = currentLog;
      
      // Vẫn vẽ danh sách khóa học hoặc player theo dạng "mờ"
      if (progressSection) progressSection.style.opacity = '0.4';
      if (listSection) listSection.style.opacity = '0.4';
      if (coursesSection) coursesSection.style.opacity = '0.4';
      return; // Dừng xử lý giao diện thông thường ở dưới
    } else {
      // Reset opacity
      if (progressSection) progressSection.style.opacity = '1';
      if (listSection) listSection.style.opacity = '1';
      if (coursesSection) coursesSection.style.opacity = '1';
      
      // Ẩn nút tải lại trang trong điều kiện bình thường
      if (btnReloadPage) btnReloadPage.style.display = 'none';
    }

    const isPlayerPage = activeTab && activeTab.url.includes('/learn/');

    // Tự động gán viewMode ban đầu
    if (viewMode === null) {
      viewMode = isPlayerPage ? 'player' : 'courses';
    }

    // Nếu tab hiện tại là trang player, khóa cứng chế độ viewMode = 'player'
    if (isPlayerPage) {
      viewMode = 'player';
    }

    // 1. Chế độ hiển thị DANH SÁCH KHÓA HỌC (viewMode === 'courses')
    if (viewMode === 'courses') {
      // Ẩn player elements
      if (progressSection) progressSection.style.display = 'none';
      if (listSection) listSection.style.display = 'none';
      if (btnStart) btnStart.style.display = 'none';
      if (courseIdContainer) courseIdContainer.style.display = 'none';
      if (btnBackToCourses) btnBackToCourses.style.display = 'none';
      
      // Hiện danh sách khóa học
      if (coursesSection) coursesSection.style.display = 'flex';
      if (btnStartBulk) btnStartBulk.style.display = 'flex';

      // Nút "Xem tiến trình khóa đang chạy" chỉ hiển thị khi đang chạy hàng loạt (bulk mode)
      if (btnViewActiveCourse) {
        btnViewActiveCourse.style.display = isBulkRunning ? 'flex' : 'none';
      }

      // Cập nhật giao diện nút hoàn thành hàng loạt
      if (btnStartBulk) {
        btnStartBulk.disabled = false;
        if (isBulkRunning) {
          btnStartBulk.setAttribute('data-action', 'stop-bulk');
          btnStartBulk.style.background = 'linear-gradient(135deg, #ef4444 0%, #f97316 100%)';
          btnStartBulk.style.boxShadow = '0 4px 15px rgba(239, 68, 68, 0.4)';
          btnStartBulk.innerHTML = `
            <svg style="width: 14px; height: 14px; fill: currentColor; margin-right: 6px;" viewBox="0 0 24 24">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
            </svg>Tạm dừng hoàn thành toàn bộ
          `;
        } else {
          btnStartBulk.setAttribute('data-action', 'start-bulk');
          btnStartBulk.style.background = '';
          btnStartBulk.style.boxShadow = '';
          const hasIncomplete = enrolledCourses && enrolledCourses.some(c => Math.round(c.completionPercentage || 0) < 100);
          btnStartBulk.disabled = !hasIncomplete;
          btnStartBulk.innerHTML = `
            <svg style="width: 14px; height: 14px; fill: currentColor; margin-right: 6px;" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z"/>
            </svg>Hoàn thành toàn bộ các khóa học
          `;
        }
      }

      courseTitleEl.textContent = 'Khóa học của tôi';
      courseIdEl.textContent = 'ID: Không có';
      if (currentLog) statusTextEl.textContent = currentLog;
      renderCoursesList(enrolledCourses || []);
      return;
    }

    // 2. Chế độ hiển thị CHI TIẾT LECTURES PLAYER (viewMode === 'player')
    // Hiện player elements
    if (progressSection) progressSection.style.display = 'flex';
    if (listSection) listSection.style.display = 'flex';
    if (courseIdContainer) courseIdContainer.style.display = 'block';

    // Ẩn danh sách khóa học và nút xem tiến trình đang chạy
    if (coursesSection) coursesSection.style.display = 'none';
    if (btnStartBulk) btnStartBulk.style.display = 'none';
    if (btnViewActiveCourse) btnViewActiveCourse.style.display = 'none';

    // Nút Bắt đầu học đơn lẻ chỉ hiện khi thực sự ở trang player
    if (btnStart) {
      btnStart.style.display = isPlayerPage ? 'flex' : 'none';
    }

    // Nút "Quay lại danh sách khóa học" chỉ hiển thị ở ngoài trang player (nhưng đang chui vào xem chi tiết bài học của khóa đang chạy)
    if (btnBackToCourses) {
      btnBackToCourses.style.display = !isPlayerPage ? 'flex' : 'none';
    }

    // Cập nhật thông tin tiêu đề và ID của khóa học hiện tại (hoặc khóa đang chạy ngầm)
    courseTitleEl.textContent = courseTitle || 'Khóa học Udemy';
    courseIdEl.textContent = courseId ? `ID: ${courseId}` : 'ID: Không rõ';

    // Tiến độ tổng thể
    const percent = Math.min(100, Math.max(0, Math.round(progressPercent || 0)));
    progressPercentEl.textContent = `${percent}%`;
    progressBarEl.style.width = `${percent}%`;
    listCounterEl.textContent = `${completedCount}/${totalCount} bài`;

    // Cập nhật log trạng thái ở bottom
    if (currentLog) {
      statusTextEl.textContent = currentLog;
    } else if (isRunning) {
      statusTextEl.textContent = 'Đang tự động chạy bài học...';
    } else if (isFinished) {
      statusTextEl.textContent = 'Hoàn thành khóa học!';
    } else {
      statusTextEl.textContent = 'Chờ lệnh từ bạn...';
    }

    // Cấu hình nút Bắt đầu hoàn thành (đơn lẻ)
    if (isRunning) {
      btnStart.disabled = false;
      btnStart.setAttribute('data-action', 'stop');
      btnStart.style.background = 'linear-gradient(135deg, #ef4444 0%, #f97316 100%)';
      btnStart.style.boxShadow = '0 4px 15px rgba(239, 68, 68, 0.4)';
      btnStart.innerHTML = `
        <svg style="width: 14px; height: 14px; fill: currentColor; margin-right: 6px;" viewBox="0 0 24 24">
          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
        </svg>Tạm dừng hoàn thành
      `;
    } else {
      btnStart.setAttribute('data-action', 'start');
      btnStart.style.background = '';
      btnStart.style.boxShadow = '';
      
      const actualLectures = lectures.filter(l => l.type !== 'chapter');
      const hasUnfinished = actualLectures.some(l => l.status !== 'done');
      const isCourseCompleted = actualLectures.length > 0 && !hasUnfinished;

      const isErrorLog = currentLog && (
        currentLog.includes('hết hạn hoặc bị logout') ||
        currentLog.includes('F5 lại trang') ||
        currentLog.includes('Không thể tải danh sách bài học') ||
        currentLog.includes('Khởi tạo thất bại')
      );

      if (isFinished || isCourseCompleted || isErrorLog) {
        btnStart.disabled = false;
        btnStart.setAttribute('data-action', 'reload');
        btnStart.style.background = 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)';
        btnStart.style.boxShadow = '0 4px 15px rgba(16, 185, 129, 0.4)';
        btnStart.innerHTML = `
          <svg style="width: 14px; height: 14px; fill: currentColor; margin-right: 6px;" viewBox="0 0 24 24">
            <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
          </svg>Tải lại trang học
        `;
      } else {
        btnStart.disabled = !hasUnfinished;
        btnStart.innerHTML = `
          <svg style="width: 14px; height: 14px; fill: currentColor; margin-right: 6px;" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z"/>
          </svg>Bắt đầu hoàn thành
        `;
      }
    }

    // Hiển thị danh sách bài học
    if (lectures && lectures.length > 0) {
      renderLecturesList(lectures);
    } else {
      lectureListEl.innerHTML = `
        <div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 11px;">
          Không tìm thấy bài học nào trong khóa học này.
        </div>
      `;
    }
  }

  // Vẽ danh sách bài học bao gồm tiêu đề chương (Chapter) và các bài học
  function renderLecturesList(lectures) {
    // Lưu lại vị trí cuộn hiện tại của list để tránh nhảy màn hình khi re-render
    const scrollPos = lectureListEl.scrollTop;

    lectureListEl.innerHTML = '';
    
    let lectureIndex = 1;
    lectures.forEach((lec) => {
      // Nếu là tiêu đề chương (Chapter/Section), vẽ dạng tiêu đề ngăn cách
      if (lec.type === 'chapter') {
        const header = document.createElement('div');
        header.className = 'chapter-header';
        header.textContent = lec.title;
        lectureListEl.appendChild(header);
        return;
      }

      const item = document.createElement('div');
      item.className = `lecture-item ${lec.status}`;
      item.id = `lecture-${lec.id}`;

      let statusBadgeHtml = '';
      if (lec.status === 'done') {
        statusBadgeHtml = '<span class="status-badge done">Đã xong</span>';
      } else if (lec.status === 'running') {
        statusBadgeHtml = '<span class="status-badge running">Đang chạy</span>';
      } else {
        statusBadgeHtml = '<span class="status-badge pending">Chờ</span>';
      }

      item.innerHTML = `
        <div class="lecture-details">
          <div class="lecture-title" title="${lec.title}">${lectureIndex++}. ${lec.title}</div>
          <div class="lecture-meta">Loại: ${getReadableType(lec.type)} | ID: ${lec.id}</div>
        </div>
        ${statusBadgeHtml}
      `;

      lectureListEl.appendChild(item);
    });

    // Phục hồi vị trí cuộn
    lectureListEl.scrollTop = scrollPos;

    // Tự động cuộn đến phần tử đang chạy để người dùng dễ quan sát
    const runningItem = lectureListEl.querySelector('.lecture-item.running');
    if (runningItem) {
      runningItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function getReadableType(type) {
    switch (type) {
      case 'lecture': return 'Bài học';
      case 'quiz': return 'Trắc nghiệm';
      case 'practice': return 'Thực hành';
      default: return type || 'Bài học';
    }
  }

  // Vẽ danh sách khóa học
  function renderCoursesList(courses) {
    if (coursesCounterEl) {
      coursesCounterEl.textContent = `${courses.length} khóa học`;
    }

    if (!coursesListEl) return;

    if (courses.length === 0) {
      coursesListEl.innerHTML = `
        <div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 11px;">
          Đang tải danh sách khóa học...
        </div>
      `;
      return;
    }

    coursesListEl.innerHTML = '';
    courses.forEach(course => {
      const card = document.createElement('a');
      card.className = 'course-card';
      const learnUrl = course.urlLanding.endsWith('/') ? course.urlLanding + 'learn/' : course.urlLanding + '/learn/';
      card.href = 'https://samsungu.udemy.com' + learnUrl;
      card.target = '_blank';

      const percent = Math.min(100, Math.max(0, Math.round(course.completionPercentage || 0)));

      card.innerHTML = `
        <img class="course-card-img" src="${course.imageUrl || 'https://via.placeholder.com/240x135'}" alt="${course.title}">
        <div class="course-card-details">
          <div class="course-card-title" title="${course.title}">${course.title}</div>
          <div class="course-card-instructors">${course.instructors || 'Giảng viên Udemy'}</div>
          <div class="course-card-progress">
            <div class="course-card-progress-bar">
              <div class="course-card-progress-fill" style="width: ${percent}%"></div>
            </div>
            <div class="course-card-progress-text">${percent}%</div>
          </div>
        </div>
      `;

      coursesListEl.appendChild(card);
    });
  }

  function showError(msg) {
    errorDisplayEl.textContent = msg;
    errorDisplayEl.classList.add('show');
    statusTextEl.textContent = 'Đã xảy ra lỗi.';
    
    // Khi xảy ra lỗi, chuyển nút thành nút "Tải lại trang học" để người dùng dễ dàng thử lại
    btnStart.disabled = false;
    btnStart.setAttribute('data-action', 'reload');
    btnStart.style.background = 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)';
    btnStart.style.boxShadow = '0 4px 15px rgba(16, 185, 129, 0.4)';
    btnStart.innerHTML = `
      <svg style="width: 14px; height: 14px; fill: currentColor; margin-right: 6px;" viewBox="0 0 24 24">
        <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
      </svg>Tải lại trang học
    `;
  }
});
