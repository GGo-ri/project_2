const SERVER_IP = 'http://192.168.0.51:8000';

let lastP1 = null;
let lastP2 = null;

// 실시간 데이터는 이력 화면을 보는 동안에도 계속 여기에 쌓임 (LIVE로 돌아와도 안 끊기게)
let liveDataP1 = [];
let liveDataP2 = [];

// ==================== 차트 초기화 ====================
const ctx = document.getElementById('soilMoistureChart').getContext('2d');

function hexToRgba(hex, alpha) {
    const clean = hex.trim().replace('#', '');
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getChartColors() {
    const styles = getComputedStyle(document.documentElement);
    const p1 = styles.getPropertyValue('--p1-purple').trim();
    const p2 = styles.getPropertyValue('--p2-orange').trim();
    return {
        p1Border: p1,
        p1Bg: hexToRgba(p1, 0.2),
        p2Border: p2,
        p2Bg: hexToRgba(p2, 0.2)
    };
}

const initialColors = getChartColors();

const soilMoistureChart = new Chart(ctx, {
    type: 'line',
    data: {
        datasets: [
            {
                label: '화분 1',
                data: liveDataP1,
                borderColor: initialColors.p1Border,
                backgroundColor: initialColors.p1Bg,
                borderWidth: 2,
                tension: 0.3,
                fill: 'origin',
                pointRadius: 3,
                spanGaps: false // 꺼져있던 구간은 선을 끊어서 표시
            },
            {
                label: '화분 2',
                data: liveDataP2,
                borderColor: initialColors.p2Border,
                backgroundColor: initialColors.p2Bg,
                borderWidth: 2,
                tension: 0.3,
                fill: 'origin',
                pointRadius: 3,
                spanGaps: false
            }
        ]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false },
        plugins: {
            legend: { display: false },
            tooltip: {
                callbacks: {
                    // 기본 12시간제(a.m./p.m.) 대신 24시간제로 직접 포맷
                    title: (items) => {
                        if (!items.length) return '';
                        const d = new Date(items[0].parsed.x);
                        const pad = n => String(n).padStart(2, '0');
                        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
                    }
                }
            },
            zoom: {
                pan: { enabled: true, mode: 'x' },
                zoom: {
                    wheel: { enabled: false },
                    pinch: { enabled: false },
                    mode: 'x'
                },
                limits: { x: { min: 'original', max: 'original' } }
            }
        },
        scales: {
            x: {
                type: 'time',
                bounds: 'data',
                time: {
                    // 시(時) 정보는 상단 "현재 구간" 라벨에서 보여주므로 축 눈금은 간결하게
                    displayFormats: {
                        second: 'mm:ss',
                        minute: 'mm:ss',
                        hour: 'HH:mm'
                    }
                },
                ticks: {
                    source: 'data',
                    autoSkip: true,
                    maxRotation: 45,
                    minRotation: 0
                }
            },
            y: {
                min: 0,
                max: 100,
                ticks: {
                    stepSize: 25,
                    callback: value => value + '%'
                }
            }
        }
    }
});

// ==================== 실시간(LIVE) 창/페이지 계산 ====================
const LIVE_PUSH_INTERVAL_MS = 10000; // 테스트용 10초 (실제 운영 시 60000으로)
const VISIBLE_POINT_COUNT = 12;
const MIN_VISIBLE_WINDOW_MS = 2 * 60 * 1000;
const VISIBLE_WINDOW_MS = Math.max(LIVE_PUSH_INTERVAL_MS * VISIBLE_POINT_COUNT, MIN_VISIBLE_WINDOW_MS);
const MIN_LIVE_AXIS_RANGE_MS = 60 * 1000; // 점이 1~2개뿐일 때 라벨 깨짐 방지용 최소 폭

// 스크롤/이전 버튼으로 과거를 보는 동안엔 새 값이 와도 화면을 안 끌고 가는 "추적 모드"
let followLiveEdge = true;

// LIVE도 이력과 동일하게 "고정 기준점"부터 VISIBLE_WINDOW_MS 크기의 페이지로 나눠서 봄
let liveWindowOriginTs = null;
let livePageIndex = null; // null = 최신 페이지
let liveTotalPages = 1;

function setAxisTimeFormat(mode) {
    const fmt = soilMoistureChart.options.scales.x.time.displayFormats;
    if (mode === 'history') {
        fmt.second = 'HH:mm:ss';
        fmt.minute = 'HH:mm';
    } else {
        fmt.second = 'mm:ss';
        fmt.minute = 'mm:ss';
    }
}

function updateAxisWindow() {
    const allPoints = [
        ...soilMoistureChart.data.datasets[0].data,
        ...soilMoistureChart.data.datasets[1].data
    ];
    if (allPoints.length === 0) return;

    const timestamps = allPoints.map(p => p.x);
    const minTs = Math.min(...timestamps);
    const maxTs = Math.max(...timestamps);

    if (liveWindowOriginTs === null) liveWindowOriginTs = minTs;

    liveTotalPages = Math.max(1, Math.ceil((maxTs - liveWindowOriginTs) / VISIBLE_WINDOW_MS));

    if (followLiveEdge || livePageIndex === null || livePageIndex > liveTotalPages - 1) {
        livePageIndex = liveTotalPages - 1;
        followLiveEdge = true;
    }
    if (livePageIndex < 0) livePageIndex = 0;

    let pageStart = liveWindowOriginTs + livePageIndex * VISIBLE_WINDOW_MS;
    let pageEnd = pageStart + VISIBLE_WINDOW_MS;

    if (livePageIndex === liveTotalPages - 1 && pageEnd > maxTs) {
        pageEnd = maxTs;
    }
    if (pageEnd - pageStart < MIN_LIVE_AXIS_RANGE_MS) {
        pageStart = pageEnd - MIN_LIVE_AXIS_RANGE_MS;
    }

    soilMoistureChart.options.scales.x.min = pageStart;
    soilMoistureChart.options.scales.x.max = pageEnd;
    soilMoistureChart.options.plugins.zoom.limits.x.min = minTs;
    soilMoistureChart.options.plugins.zoom.limits.x.max = maxTs;

    updateCurrentRangeLabel(pageStart, pageEnd);
    updateHistoryNavUI();
}

// 그래프 상단에 "지금 보고 있는 시간대"를 표시
function updateCurrentRangeLabel(startTs, endTs) {
    const label = document.getElementById('currentRangeLabel');
    if (!label) return;

    if (startTs === undefined || endTs === undefined) {
        label.textContent = '';
        return;
    }

    const fmt = ts => {
        const d = new Date(ts);
        const pad = n => String(n).padStart(2, '0');
        return {
            date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
            time: `${pad(d.getHours())}:${pad(d.getMinutes())}`
        };
    };

    const start = fmt(startTs);
    const end = fmt(endTs);

    if (start.date === end.date && start.time === end.time) {
        label.textContent = `${start.date}  ${start.time}`;
    } else if (start.date === end.date) {
        label.textContent = `${start.date}  ${start.time} ~ ${end.time}`;
    } else {
        label.textContent = `${start.date} ${start.time} ~ ${end.date} ${end.time}`;
    }
}

// 간격이 thresholdMs보다 크게 벌어지면 null을 끼워 선을 끊음 (= 꺼져있던 구간)
function appendPointWithGapCheck(arr, x, y, thresholdMs) {
    const lastReal = [...arr].reverse().find(p => p.y !== null);
    if (lastReal && x - lastReal.x > thresholdMs) {
        arr.push({ x: (lastReal.x + x) / 2, y: null });
    }
    arr.push({ x, y });
}

const LIVE_GAP_THRESHOLD_MS = LIVE_PUSH_INTERVAL_MS * 6;

function pushLivePoint() {
    const now = Date.now();
    if (lastP1 !== null) appendPointWithGapCheck(liveDataP1, now, lastP1, LIVE_GAP_THRESHOLD_MS);
    if (lastP2 !== null) appendPointWithGapCheck(liveDataP2, now, lastP2, LIVE_GAP_THRESHOLD_MS);

    if (isLiveMode) {
        if (followLiveEdge) updateAxisWindow();
        soilMoistureChart.update();
    }
}
setInterval(pushLivePoint, LIVE_PUSH_INTERVAL_MS);

// ==================== 다크모드 토글 ====================
function applyChartTheme(theme) {
    const gridColor = theme === 'dark' ? 'rgba(148, 163, 184, 0.15)' : 'rgba(100, 116, 139, 0.1)';
    const tickColor = theme === 'dark' ? '#94a3b8' : '#64748b';

    soilMoistureChart.options.scales.x.ticks.color = tickColor;
    soilMoistureChart.options.scales.x.grid = { color: gridColor };
    soilMoistureChart.options.scales.y.ticks.color = tickColor;
    soilMoistureChart.options.scales.y.grid = { color: gridColor };

    const colors = getChartColors();
    soilMoistureChart.data.datasets[0].borderColor = colors.p1Border;
    soilMoistureChart.data.datasets[0].backgroundColor = colors.p1Bg;
    soilMoistureChart.data.datasets[1].borderColor = colors.p2Border;
    soilMoistureChart.data.datasets[1].backgroundColor = colors.p2Bg;

    soilMoistureChart.update('none');
}

function toggleTheme() {
    const root = document.documentElement;
    const isDark = root.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';

    if (newTheme === 'dark') {
        root.setAttribute('data-theme', 'dark');
    } else {
        root.removeAttribute('data-theme');
    }

    localStorage.setItem('theme', newTheme);
    applyChartTheme(newTheme);
}

applyChartTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');

// ==================== LIVE / 날짜 선택 & 달력 ====================
let isLiveMode = true;
let selectedDateStr = null;
let calendarViewYear, calendarViewMonth;

function todayStr() {
    return new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD
}

function updateLiveUI() {
    const badge = document.getElementById('liveBadge');
    const dot = badge.querySelector('.live-dot');

    if (isLiveMode) {
        badge.classList.add('active');
        dot.classList.add('pulsing');
    } else {
        badge.classList.remove('active');
        dot.classList.remove('pulsing');
    }
}

function setLiveMode(active) {
    isLiveMode = active;

    if (active) {
        setAxisTimeFormat('live');

        selectedDateStr = null;
        document.getElementById('datePickerBtn').textContent = '날짜 선택';
        document.getElementById('datePickerBtn').classList.remove('has-date');

        soilMoistureChart.data.datasets[0].data = liveDataP1;
        soilMoistureChart.data.datasets[1].data = liveDataP2;

        followLiveEdge = true;
        updateAxisWindow();
        soilMoistureChart.update();
    }

    const toggleEl = document.getElementById('intervalToggle');
    if (toggleEl) toggleEl.classList.toggle('disabled', active);

    updateLiveUI();
}

function toggleCalendar() {
    const popup = document.getElementById('calendarPopup');
    const isHidden = popup.hasAttribute('hidden');

    if (isHidden) {
        const base = selectedDateStr ? new Date(selectedDateStr) : new Date();
        calendarViewYear = base.getFullYear();
        calendarViewMonth = base.getMonth();
        renderCalendar();
        popup.removeAttribute('hidden');
    } else {
        popup.setAttribute('hidden', '');
    }
}

function changeCalendarMonth(delta) {
    calendarViewMonth += delta;
    if (calendarViewMonth < 0) { calendarViewMonth = 11; calendarViewYear--; }
    if (calendarViewMonth > 11) { calendarViewMonth = 0; calendarViewYear++; }
    renderCalendar();
}

function renderCalendar() {
    const monthLabel = document.getElementById('calendarMonthLabel');
    const daysContainer = document.getElementById('calendarDays');

    monthLabel.textContent = `${calendarViewYear}년 ${calendarViewMonth + 1}월`;
    daysContainer.innerHTML = '';

    const firstWeekday = new Date(calendarViewYear, calendarViewMonth, 1).getDay();
    const totalDays = new Date(calendarViewYear, calendarViewMonth + 1, 0).getDate();
    const today = todayStr();

    for (let i = 0; i < firstWeekday; i++) {
        const empty = document.createElement('span');
        empty.className = 'calendar-day empty';
        daysContainer.appendChild(empty);
    }

    for (let day = 1; day <= totalDays; day++) {
        const m = String(calendarViewMonth + 1).padStart(2, '0');
        const d = String(day).padStart(2, '0');
        const dateStr = `${calendarViewYear}-${m}-${d}`;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'calendar-day';
        btn.textContent = day;

        if (dateStr === today) btn.classList.add('today');
        if (dateStr === selectedDateStr) btn.classList.add('selected');

        btn.onclick = () => selectCalendarDate(dateStr);
        daysContainer.appendChild(btn);
    }
}

function selectCalendarDate(dateStr) {
    selectedDateStr = dateStr;
    document.getElementById('calendarPopup').setAttribute('hidden', '');

    const btn = document.getElementById('datePickerBtn');
    btn.textContent = dateStr;
    btn.classList.add('has-date');

    handleDateChange(dateStr);
}

document.addEventListener('click', (e) => {
    const wrapper = document.querySelector('.date-select-wrapper');
    const popup = document.getElementById('calendarPopup');
    if (wrapper && !wrapper.contains(e.target) && !popup.hasAttribute('hidden')) {
        popup.setAttribute('hidden', '');
    }
});

function handleDateChange(dateStr) {
    if (!dateStr) return;

    if (dateStr === todayStr()) {
        setLiveMode(true);
    } else {
        isLiveMode = false;
        updateLiveUI();

        const toggleEl = document.getElementById('intervalToggle');
        if (toggleEl) toggleEl.classList.remove('disabled');

        loadHistoryForDate(dateStr);
    }
}

// ==================== 이력 더미 데이터 (백엔드 제공 로직 이식) ====================
const USE_DUMMY_HISTORY = true; // 실제 API 붙이면 false

function generateBackendDummySeries(plantId, dateStr, startMoisture, decay, wateringEvents, startTime, endTime) {
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const startMinutes = sh * 60 + sm;
    const endMinutes = eh * 60 + em;

    const data = [];
    let index = 0;

    for (let minutes = startMinutes; minutes <= endMinutes; minutes += 5, index++) {
        let moisture = startMoisture - decay * index;

        wateringEvents.forEach(([eventIndex, increase]) => {
            if (index >= eventIndex) moisture += increase;
        });

        moisture = Math.round(moisture * 10) / 10;

        const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
        const mm = String(minutes % 60).padStart(2, '0');

        data.push({
            plant_id: plantId,
            measured_at: `${dateStr}T${hh}:${mm}:00`,
            moisture
        });
    }
    return data;
}

const BACKEND_DUMMY_DATA = [
    // 2026-08-20 (24시간)
    ...generateBackendDummySeries(1, '2026-08-20', 58.5, 0.07, [[72, 10], [144, 9], [216, 8]], '00:00', '23:55'),
    ...generateBackendDummySeries(2, '2026-08-20', 54.8, 0.08, [[60, 11], [132, 10], [204, 9]], '00:00', '23:55'),

    // 2026-08-21 (24시간)
    ...generateBackendDummySeries(1, '2026-08-21', 52.6, 0.075, [[84, 10], [156, 9], [228, 8]], '00:00', '23:55'),
    ...generateBackendDummySeries(2, '2026-08-21', 49.7, 0.085, [[72, 11], [144, 10], [216, 9]], '00:00', '23:55'),

    // 2026-08-24 (오늘, 00:00~12:00)
    ...generateBackendDummySeries(1, '2026-08-24', 58.4, 0.18, [[36, 12], [84, 10]], '00:00', '12:00'),
    ...generateBackendDummySeries(2, '2026-08-24', 51.7, 0.22, [[48, 11], [96, 9]], '00:00', '12:00')
];

function aggregateToHourly(rawList) {
    const pad = n => String(n).padStart(2, '0');
    const buckets = new Map();

    rawList.forEach(item => {
        const d = new Date(item.measured_at);
        const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00:00`;

        if (!buckets.has(key)) buckets.set(key, { sum: 0, count: 0 });
        const b = buckets.get(key);
        b.sum += item.moisture;
        b.count += 1;
    });

    return Array.from(buckets.entries()).map(([key, b]) => ({
        measured_at: key,
        moisture: b.sum / b.count
    }));
}

function buildHistoryPoints(rawList, gapThresholdMs) {
    const sorted = [...rawList].sort((a, b) => new Date(a.measured_at) - new Date(b.measured_at));

    const points = [];
    for (let i = 0; i < sorted.length; i++) {
        const curTime = new Date(sorted[i].measured_at).getTime();

        if (i > 0) {
            const prevTime = new Date(sorted[i - 1].measured_at).getTime();
            if (curTime - prevTime > gapThresholdMs) {
                points.push({ x: (prevTime + curTime) / 2, y: null });
            }
        }

        points.push({ x: curTime, y: Math.round(sorted[i].moisture) });
    }
    return points;
}

async function fetchHistoryFromServer(plantId, dateStr) {
    try {
        const res = await fetch(`${SERVER_IP}/api/plants/${plantId}/moisture/history?date=${dateStr}`);
        if (!res.ok) return [];
        return await res.json();
    } catch (err) {
        console.warn('이력 조회 실패, 빈 배열로 처리:', err);
        return [];
    }
}

function filterDummyByPlantAndDate(plantId, dateStr) {
    return BACKEND_DUMMY_DATA.filter(d => d.plant_id === plantId && d.measured_at.startsWith(dateStr));
}

// ==================== 5분 / 1시간 토글 & 페이지 렌더링 ====================
let historyInterval = '1hour'; // '5min' | '1hour' — 초기 화면 기본 단위
let lastHistoryRawDataP1 = [];
let lastHistoryRawDataP2 = [];

// 5분 단위는 "정각 기준 1시간짜리 페이지"로 나눔 (예: 03:15 시작 데이터도 첫 페이지는 03:00~04:00)
let historyPageIndex = null; // null = 마지막 페이지
let historyTotalPages = 1;

function floorToHour(ts) {
    const d = new Date(ts);
    d.setMinutes(0, 0, 0);
    return d.getTime();
}

function getHistoryTotalPages(minTs, maxTs) {
    const firstHour = floorToHour(minTs);
    // 마지막 데이터가 정각에 딱 걸치면 그건 새 페이지가 아니라 직전 페이지의 마지막 점
    const lastHour = floorToHour(maxTs - 1);
    return Math.round((lastHour - firstHour) / (60 * 60 * 1000)) + 1;
}

function getHistoryPageBounds(minTs, pageIndex) {
    const firstHour = floorToHour(minTs);
    const pageStart = firstHour + pageIndex * 60 * 60 * 1000;
    const pageEnd = pageStart + 60 * 60 * 1000;
    return { pageStart, pageEnd };
}

function updateIntervalToggleUI() {
    const el = document.getElementById('intervalToggle');
    if (el) el.classList.toggle('hour-mode', historyInterval === '1hour');
}

function toggleHistoryInterval() {
    if (isLiveMode) return;
    historyInterval = historyInterval === '5min' ? '1hour' : '5min';
    updateIntervalToggleUI();
    renderHistoryChart();
}

function renderHistoryChart() {
    setAxisTimeFormat('history');

    const sourceP1 = historyInterval === '1hour' ? aggregateToHourly(lastHistoryRawDataP1) : lastHistoryRawDataP1;
    const sourceP2 = historyInterval === '1hour' ? aggregateToHourly(lastHistoryRawDataP2) : lastHistoryRawDataP2;
    const gapThreshold = historyInterval === '1hour' ? 70 * 60 * 1000 : 6 * 60 * 1000;

    const pointsP1 = buildHistoryPoints(sourceP1, gapThreshold);
    const pointsP2 = buildHistoryPoints(sourceP2, gapThreshold);

    soilMoistureChart.data.datasets[0].data = pointsP1;
    soilMoistureChart.data.datasets[1].data = pointsP2;

    const validTimes = [...pointsP1, ...pointsP2].filter(p => p.y !== null).map(p => p.x);

    if (validTimes.length === 0) {
        soilMoistureChart.update();
        updateCurrentRangeLabel();
        historyTotalPages = 1;
        updateHistoryNavUI();
        return;
    }

    const minTs = Math.min(...validTimes);
    const maxTs = Math.max(...validTimes);

    if (historyInterval === '1hour') {
        // 페이지 없이 실제 데이터 범위를 그대로 다 보여줌
        const MIN_MEANINGFUL_RANGE_MS = 30 * 60 * 1000;

        if (maxTs - minTs < MIN_MEANINGFUL_RANGE_MS) {
            // 데이터가 1개뿐이면 축 라벨이 깨지는 걸 방지하기 위해 여유를 줌
            const pad = MIN_MEANINGFUL_RANGE_MS / 2;
            soilMoistureChart.options.scales.x.min = minTs - pad;
            soilMoistureChart.options.scales.x.max = maxTs + pad;
        } else {
            soilMoistureChart.options.scales.x.min = undefined;
            soilMoistureChart.options.scales.x.max = undefined;
        }

        soilMoistureChart.update();
        updateCurrentRangeLabel(minTs, maxTs);
        updateHistoryNavUI();
        return;
    }

    // 5분 단위: 정각 기준 1시간 페이지
    historyTotalPages = getHistoryTotalPages(minTs, maxTs);

    if (historyPageIndex === null || historyPageIndex > historyTotalPages - 1) {
        historyPageIndex = historyTotalPages - 1;
    }
    if (historyPageIndex < 0) historyPageIndex = 0;

    let { pageStart, pageEnd } = getHistoryPageBounds(minTs, historyPageIndex);

    // 마지막 페이지에서 정각까지 데이터가 안 채워졌으면 실제 마지막 지점에서 끊음
    if (historyPageIndex === historyTotalPages - 1 && pageEnd > maxTs) {
        pageEnd = maxTs;
    }

    soilMoistureChart.options.scales.x.min = pageStart;
    soilMoistureChart.options.scales.x.max = pageEnd;

    soilMoistureChart.update();
    updateCurrentRangeLabel(pageStart, pageEnd);
    updateHistoryNavUI();
}

function handlePrevClick() {
    if (isLiveMode) {
        shiftLiveWindow(-1);
    } else {
        historyPageIndex -= 1;
        renderHistoryChart();
    }
}

function handleNextClick() {
    if (isLiveMode) {
        shiftLiveWindow(1);
    } else {
        historyPageIndex += 1;
        renderHistoryChart();
    }
}

function shiftLiveWindow(direction) {
    if (direction < 0 && livePageIndex <= 0) {
        // 실시간 데이터의 맨 처음보다 더 과거로 가려 하면 이력 마지막 페이지로 전환
        switchToHistoryLastPage();
        return;
    }

    followLiveEdge = false;
    livePageIndex += direction;

    updateAxisWindow(); // 최신 페이지 도달 시 자동으로 추적 모드 복귀
    soilMoistureChart.update(); // 이력 페이지 이동과 동일하게 애니메이션 켜서 부드럽게 전환
}

function switchToHistoryLastPage() {
    isLiveMode = false;
    updateLiveUI();

    const toggleEl = document.getElementById('intervalToggle');
    if (toggleEl) toggleEl.classList.remove('disabled');

    selectedDateStr = todayStr();
    const btn = document.getElementById('datePickerBtn');
    if (btn) {
        btn.textContent = todayStr();
        btn.classList.add('has-date');
    }

    loadHistoryForDate(todayStr());
}

function updateHistoryNavUI() {
    const nav = document.getElementById('historyNav');
    const prevBtn = document.getElementById('historyPrevBtn');
    const nextBtn = document.getElementById('historyNextBtn');
    if (!nav || !prevBtn || !nextBtn) return;

    if (isLiveMode) {
        nav.hidden = false;
        prevBtn.disabled = false; // 맨 처음이면 눌렀을 때 이력 화면으로 전환됨
        nextBtn.disabled = livePageIndex >= liveTotalPages - 1;
    } else if (historyInterval === '1hour') {
        nav.hidden = true;
    } else {
        nav.hidden = false;
        prevBtn.disabled = historyPageIndex <= 0;
        nextBtn.disabled = historyPageIndex >= historyTotalPages - 1;
    }
}

async function loadHistoryForDate(dateStr) {
    if (USE_DUMMY_HISTORY) {
        lastHistoryRawDataP1 = filterDummyByPlantAndDate(1, dateStr);
        lastHistoryRawDataP2 = filterDummyByPlantAndDate(2, dateStr);
    } else {
        lastHistoryRawDataP1 = await fetchHistoryFromServer(1, dateStr);
        lastHistoryRawDataP2 = await fetchHistoryFromServer(2, dateStr);
    }

    historyPageIndex = null; // 새 날짜는 항상 마지막 페이지부터
    renderHistoryChart();
}

// ==================== 초기 화면 ====================
// 오늘 날짜를 과거 날짜 조회처럼 취급해서 1시간 단위 마지막 페이지를 먼저 정적으로 보여줌.
// 단, 오늘 아직 기록된 데이터가 없으면(=시스템을 오늘 처음 켠 경우) 빈 화면 대신
// 데이터가 있는 가장 최근 날짜(마지막으로 가동됐던 날)를 찾아서 그 마지막 페이지를 보여줌.
// LIVE는 사용자가 버튼을 눌러야 시작됨 (5분 이력과 실시간 데이터의 해상도가 섞이지 않도록)
isLiveMode = false;
document.getElementById('intervalToggle').classList.remove('disabled');
updateIntervalToggleUI(); // 스위치 UI를 historyInterval 기본값(1시간)에 맞게 표시
updateLiveUI();

async function fetchRawForDate(dateStr) {
    if (USE_DUMMY_HISTORY) {
        return {
            p1: filterDummyByPlantAndDate(1, dateStr),
            p2: filterDummyByPlantAndDate(2, dateStr),
        };
    }
    return {
        p1: await fetchHistoryFromServer(1, dateStr),
        p2: await fetchHistoryFromServer(2, dateStr),
    };
}

async function loadMostRecentAvailableHistory(maxDaysBack = 14) {
    const base = new Date();

    for (let i = 0; i <= maxDaysBack; i++) {
        const d = new Date(base);
        d.setDate(d.getDate() - i);
        const dateStr = d.toLocaleDateString('sv-SE'); // YYYY-MM-DD

        const { p1, p2 } = await fetchRawForDate(dateStr);

        if (p1.length > 0 || p2.length > 0) {
            lastHistoryRawDataP1 = p1;
            lastHistoryRawDataP2 = p2;
            historyPageIndex = null; // 마지막 페이지부터

            selectedDateStr = dateStr;
            const btn = document.getElementById('datePickerBtn');
            if (btn) {
                btn.textContent = dateStr;
                btn.classList.add('has-date');
            }

            renderHistoryChart();
            return;
        }
    }

    // maxDaysBack 만큼 거슬러 올라가도 데이터가 하나도 없으면 오늘 날짜로 빈 화면 표시
    selectedDateStr = todayStr();
    const btn = document.getElementById('datePickerBtn');
    if (btn) {
        btn.textContent = todayStr();
        btn.classList.add('has-date');
    }
    renderHistoryChart();
}

loadMostRecentAvailableHistory();

// ==================== 실시간 시스템 로그 ====================
let lastLogKey = null;
let screenFlashTimer = null;

// ERROR 로그가 들어오면 화면 전체를 1~2회 번쩍여서 하단 로그 패널로 시선을 유도
function triggerScreenFlash() {
    const overlay = document.getElementById('screenFlashOverlay');
    if (!overlay) return;

    overlay.classList.remove('active');
    void overlay.offsetWidth; // 리플로우 강제 발생시켜 애니메이션 재시작 가능하게 함
    overlay.classList.add('active');

    clearTimeout(screenFlashTimer);
    screenFlashTimer = setTimeout(() => overlay.classList.remove('active'), 1000); // 0.5s x 2회
}

function formatLogTime(isoString) {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '--:--:--';
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function appendLogLine(log) {
    const container = document.getElementById('logLines');

    const empty = container.querySelector('.log-empty');
    if (empty) empty.remove();

    const level = (log.level || 'INFO').toUpperCase();
    const isError = level === 'ERROR';

    const line = document.createElement('div');
    line.className = `log-line level-${level.toLowerCase()}`;

    // 로그 자체의 발생 시각이 최근(15초 이내)일 때만 화면 전체를 번쩍임
    // (페이지를 처음 열 때 서버에 이미 쌓여있던 과거 로그까지 "새로 추가됨"으로 착각해서
    //  깜빡이지 않도록, 실제 로그 시각을 기준으로 판단)
    if (isError) {
        const logTime = new Date(log.created_at || log.timestamp).getTime();
        const isRecent = !isNaN(logTime) && (Date.now() - logTime) < 15000;
        if (isRecent) triggerScreenFlash();
    }

    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = formatLogTime(log.created_at || log.timestamp);

    const levelTag = document.createElement('span');
    levelTag.className = 'log-level';
    levelTag.textContent = `${level}:`;

    const message = document.createElement('span');
    message.textContent = log.message || `${log.source || ''} ${log.event_type || ''}`.trim();

    line.appendChild(time);
    line.appendChild(levelTag);
    line.appendChild(message);
    container.appendChild(line);

    while (container.children.length > 200) {
        container.removeChild(container.firstChild);
    }

    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 40;
    if (nearBottom) container.scrollTop = container.scrollHeight;
}

function logKeyOf(log) {
    return log.id ?? `${log.created_at || log.timestamp}-${log.event_type}-${log.source}`;
}

async function pollSystemLogs() {
    try {
        const res = await fetch(`${SERVER_IP}/api/system/logs`);
        if (!res.ok) return;

        const logs = await res.json();
        if (!Array.isArray(logs) || logs.length === 0) return;

        const sorted = [...logs].sort((a, b) =>
            new Date(a.created_at || a.timestamp) - new Date(b.created_at || b.timestamp)
        );

        let startIndex = 0;
        if (lastLogKey !== null) {
            const idx = sorted.findIndex(l => logKeyOf(l) === lastLogKey);
            startIndex = idx >= 0 ? idx + 1 : 0;
        }

        for (let i = startIndex; i < sorted.length; i++) {
            appendLogLine(sorted[i]);
        }

        if (sorted.length > 0) lastLogKey = logKeyOf(sorted[sorted.length - 1]);
    } catch (err) {
        console.warn('시스템 로그 응답 대기 중');
    }
}

pollSystemLogs();
setInterval(pollSystemLogs, 700);

// ==================== 화분 수치 폴링 + 연결 상태 배지 ====================
let connFailureCount = 0;
const CONN_FAILURE_THRESHOLD = 2; // 연속 2번 실패해야 표시 (일시적 지연은 무시)

function setConnBadge(visible) {
    const badge = document.getElementById('connBadge');
    if (badge) badge.hidden = !visible;
}

async function fetchMoistureData() {
    let success = false;

    try {
        const res = await fetch(`${SERVER_IP}/api/dashboard`);
        if (res.ok) {
            success = true;
            const data = await res.json();
            if (data && Array.isArray(data.plants)) {
                const plant1 = data.plants.find(p => p.id === 1);
                const plant2 = data.plants.find(p => p.id === 2);

                if (plant1 && !isNaN(plant1.moisture)) lastP1 = Number(plant1.moisture);
                if (plant2 && !isNaN(plant2.moisture)) lastP2 = Number(plant2.moisture);
            }
        }
    } catch (err) {
        console.warn('서버 응답 대기 중 - 기존 측정값 유지');
    }

    if (success) {
        connFailureCount = 0;
        setConnBadge(false);
    } else {
        connFailureCount += 1;
        if (connFailureCount >= CONN_FAILURE_THRESHOLD) setConnBadge(true);
    }

    const p1ValElem = document.getElementById('p1Val');
    const p2ValElem = document.getElementById('p2Val');

    if (p1ValElem) p1ValElem.innerText = lastP1 !== null ? `${lastP1}%` : '--%';
    if (p2ValElem) p2ValElem.innerText = lastP2 !== null ? `${lastP2}%` : '--%';
}

fetchMoistureData();
setInterval(fetchMoistureData, 2500);

// ==================== 급수 기록 (상시 패널) ====================
async function refreshWateringLog() {
    const list = document.getElementById('wateringLogList');
    if (!list) return;

    try {
        const response = await fetch(`${SERVER_IP}/api/watering/log`);
        if (!response.ok) throw new Error(`HTTP 오류! 상태 코드 : ${response.status}`);

        const logs = await response.json();

        if (!Array.isArray(logs) || logs.length === 0) {
            list.innerHTML = '<div class="log-empty">급수 기록이 없습니다.</div>';
            return;
        }

        // created_at 기준으로 직접 정렬 (최신이 위로) — API가 어떤 순서로 주든 항상 정확하게 동작
        const sortedLogs = [...logs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        list.innerHTML = sortedLogs.map(item => {
            const formattedTime = item.created_at ? item.created_at.replace('T', ' ') : '-';
            const isSuccess = item.result === 'SUCCESS';
            const resultText = isSuccess ? '성공' : '실패';
            const resultClass = isSuccess ? 'status-success' : 'status-fail';

            return `
                <div class="watering-log-row">
                    <span class="watering-log-time">${formattedTime}</span>
                    <span class="watering-log-plant">화분 ${item.plant_id}</span>
                    <span class="${resultClass}">${resultText}</span>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('급수 기록 데이터 불러오기 실패:', error);
        list.innerHTML = '<div class="log-empty">기록을 불러오지 못했습니다.</div>';
    }
}

refreshWateringLog();
setInterval(refreshWateringLog, 5000);

// ==================== 수동 급수 ====================
function setWateringStatus(plantId, message, isError) {
    const el = document.getElementById(`wateringStatus${plantId}`);
    if (!el) return;
    el.textContent = message;
    el.style.color = isError ? '#fca5a5' : 'inherit';
}

async function triggerManualWatering(plantId) {
    const btn = document.getElementById(`waterBtn${plantId}`);
    if (btn) btn.disabled = true;

    setWateringStatus(plantId, '요청 중...', false);

    try {
        const res = await fetch(`${SERVER_IP}/api/watering`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plant_id: plantId })
        });

        if (res.status === 409) {
            setWateringStatus(plantId, '이미 급수 작업이 진행 중입니다.', true);
            return;
        }
        if (!res.ok) throw new Error(`HTTP 오류! 상태 코드: ${res.status}`);

        const data = await res.json(); // { task_id, plant_id, status: "QUEUED", source: "MANUAL" }
        setWateringStatus(plantId, `대기열에 등록됨 (Task #${data.task_id})`, false);

        setTimeout(refreshWateringLog, 3000);
    } catch (err) {
        console.error('수동 급수 요청 실패:', err);
        setWateringStatus(plantId, '요청에 실패했습니다. 다시 시도해주세요.', true);
    } finally {
        if (btn) btn.disabled = false;
    }
}

// ==================== AGV 상태 배지 ====================
const AGV_STATUS_MAP = {
    idle: { text: '대기', dotClass: 'agv-dot-idle' },
    moving: { text: '이동 중', dotClass: 'agv-dot-moving' },
    watering: { text: '급수 진행 중', dotClass: 'agv-dot-watering' },
    returning: { text: '복귀 중', dotClass: 'agv-dot-moving' },
    error: { text: '오류 발생', dotClass: 'agv-dot-error' }
};

function setAgvStatus(stateKey) {
    const dot = document.getElementById('agvDot');
    const text = document.getElementById('agvStatusText');
    if (!dot || !text) return;

    const s = AGV_STATUS_MAP[stateKey] || AGV_STATUS_MAP.idle;
    dot.className = `agv-dot ${s.dotClass}`;
    text.textContent = s.text;
}

// AGV 상태 배지를 두 API로 판단함
// 1) GET /api/watering/tasks — 활성 Task가 있으면 그 진행 단계(QUEUED/MOVING/ARRIVED/WATERING)로 판단
// 2) 활성 Task가 하나도 없으면 GET /api/agv/command로 RETURN 여부 확인 (복귀 중인지, 완전 대기인지)
const TASK_STATE_TO_STATUS = {
    queued: 'idle',       // 아직 출발 전 대기
    moving: 'moving',
    arrived: 'moving',    // 도착은 했지만 급수 시작 전 — "이동 중"과 묶어서 표시
    watering: 'watering'
};

// 더 이상 "진행 중"이 아닌, 끝난 상태로 취급할 값들 (성공/실패 둘 다 포함)
const TERMINAL_TASK_STATES = ['completed', 'failed', 'error'];

async function pollAgvStatusForDashboard() {
    try {
        const res = await fetch(`${SERVER_IP}/api/watering/tasks`);
        if (!res.ok) return;

        const tasks = await res.json();
        if (!Array.isArray(tasks)) return;

        const activeTask = tasks.find(
            t => !TERMINAL_TASK_STATES.includes((t.status || t.state || '').toLowerCase())
        );

        if (activeTask) {
            const state = (activeTask.status || activeTask.state || '').toLowerCase();
            const statusKey = TASK_STATE_TO_STATUS[state];
            if (statusKey) setAgvStatus(statusKey);
            return;
        }

        // 활성 Task가 없을 때, 가장 최근 Task가 실패(FAILED/ERROR)로 끝났으면 "오류"로 표시
        // (성공적으로 COMPLETED된 경우와 구분해서, 조용히 대기 처리되지 않게 함)
        const lastTask = tasks[tasks.length - 1];
        const lastState = lastTask ? (lastTask.status || lastTask.state || '').toLowerCase() : '';
        if (lastState === 'failed' || lastState === 'error') {
            setAgvStatus('error');
            return;
        }

        // 그 외(정상 COMPLETED)엔 기존 로직대로: 일단 "복귀 중"으로 보고,
        // command가 명확히 WAIT일 때만 "대기"로 확정
        const cmdRes = await fetch(`${SERVER_IP}/api/agv/command`);
        if (!cmdRes.ok) {
            setAgvStatus('returning');
            return;
        }

        const cmdData = await cmdRes.json();
        const command = (cmdData.command || '').toLowerCase();

        setAgvStatus(command === 'wait' ? 'idle' : 'returning');
    } catch (err) {
        console.warn('AGV 상태 조회 실패 - 이전 상태 유지');
    }
}

pollAgvStatusForDashboard();
setInterval(pollAgvStatusForDashboard, 3000);
