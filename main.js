const SERVER_IP = 'http://192.168.0.51:8000';

let lastP1 = 50;
let lastP2 = 50;

const ctx = document.getElementById('soilMoistureChart').getContext('2d');

const soilMoistureChart = new Chart(ctx, {
    type: 'line',
    data: {
        datasets: [
            {
                label: '화분 1',
                data: [],
                borderColor: '#6c5ce7',
                backgroundColor: 'rgba(108, 92, 231, 0.2)',
                borderWidth: 2,
                tension: 0.3,
                fill: 'origin',
                pointRadius: 3
            },
            {
                label: '화분 2',
                data: [],
                borderColor: '#ff7675',
                backgroundColor: 'rgba(255, 118, 117, 0.2)',
                borderWidth: 2,
                tension: 0.3,
                fill: 'origin',
                pointRadius: 3
            }
        ]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false },
        plugins: {
            legend: { display: false },
            streaming: {
                frameRate: 30
            }
        },
        scales: {
            x: {
                type: 'realtime',
                realtime: {
                    duration: 20000,
                    refresh: 2500,
                    delay: 3000,
                    pause: false,
                    ttl: 25000,
                    onRefresh: chart => {
                        chart.data.datasets[0].data.push({ x: Date.now(), y: lastP1 });
                        chart.data.datasets[1].data.push({ x: Date.now(), y: lastP2 });
                    }
                },
                ticks: {
                    source: 'auto'
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

// 서버 값 갱신
async function fetchMoistureData() {
    try {
        const res = await fetch(`${SERVER_IP}/api/dashboard`);
        if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.plants)) {
                const plant1 = data.plants.find(p => p.id === 1);
                const plant2 = data.plants.find(p => p.id === 2);

                if (plant1 && !isNaN(plant1.moisture) && Number(plant1.moisture) > 0) {
                    lastP1 = Number(plant1.moisture);
                }
                if (plant2 && !isNaN(plant2.moisture) && Number(plant2.moisture) > 0) {
                    lastP2 = Number(plant2.moisture);
                }
            }
        }
    } catch (err) {
        console.warn("서버 응답 대기 중 - 기존 측정값 유지");
    }

    const p1ValElem = document.getElementById('p1Val');
    const p2ValElem = document.getElementById('p2Val');

    if (p1ValElem) p1ValElem.innerText = `${lastP1}%`;
    if (p2ValElem) p2ValElem.innerText = `${lastP2}%`;
}

fetchMoistureData();
setInterval(fetchMoistureData, 2500);

// 급수 기록
const historyData = [
    { time: '2026-08-18 14:20:15', plant: '화분 1', result: '성공' },
    { time: '2026-08-18 15:05:42', plant: '화분 2', result: '성공' }
];

function openHistoryModal() {
    const tableBody = document.getElementById('historyTableBody');
    if (!tableBody) return;

    tableBody.innerHTML = '';

    historyData.forEach(item => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${item.time}</td>
            <td>${item.plant}</td>
            <td><span class="status-success">${item.result}</span></td>
        `;
        tableBody.appendChild(row);
    });

    const modal = document.getElementById('historyModal');
    if (modal) modal.style.display = 'flex';
}

function closeHistoryModal() {
    const modal = document.getElementById('historyModal');
    if (modal) modal.style.display = 'none';
}

// 이벤트 테스트
let isRunning = false;

function runFullScenario() {
    if (isRunning) return;
    isRunning = true;

    const agvBadge = document.getElementById('agvBadge');
    const modal = document.getElementById('eventModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalMsg = document.getElementById('modalMessage');

    document.body.classList.add('warning-flash');
    if (agvBadge) {
        agvBadge.innerText = '[경고 발생]';
        agvBadge.style.color = '#e53e3e';
    }

    if (modalTitle) {
        modalTitle.innerText = "경고 발생";
        modalTitle.style.color = "#e53e3e";
    }
    if (modalMsg) modalMsg.innerHTML = "<strong>1번 화분 수분 부족 감지!</strong>";
    if (modal) modal.style.display = 'flex';

    setTimeout(() => {
        if (modalTitle) {
            modalTitle.innerText = "AGV 자동 급수 진행 중";
            modalTitle.style.color = "#6c5ce7";
        }
        if (agvBadge) {
            agvBadge.innerText = '[이동 중]';
            agvBadge.style.color = '#6c5ce7';
        }
        if (modalMsg) modalMsg.innerHTML = "1번 화분으로 이동 중...";
    }, 2500);

    setTimeout(() => {
        if (agvBadge) agvBadge.innerText = '[급수 시작]';
        if (modalMsg) modalMsg.innerHTML = "1번 화분 도착 완료<br><span style='color: #d97706;'>급수 시작</span>";
    }, 5000);

    setTimeout(() => {
        if (agvBadge) {
            agvBadge.innerText = '[급수 중]';
            agvBadge.style.color = '#d97706';
        }
        if (modalMsg) modalMsg.innerHTML = "급수 진행 중...";
    }, 7000);

    setTimeout(() => {
        if (agvBadge) {
            agvBadge.innerText = '[급수 완료]';
            agvBadge.style.color = '#059669';
        }
        if (modalMsg) modalMsg.innerHTML = "<span style='color: #059669;'>1번 화분 급수 완료</span>";
    }, 9500);

    setTimeout(() => {
        if (agvBadge) {
            agvBadge.innerText = '[복귀 중]';
            agvBadge.style.color = '#6c5ce7';
        }
        if (modalMsg) modalMsg.innerHTML = "원래 위치로 복귀 중...";
    }, 11500);

    setTimeout(() => {
        if (agvBadge) agvBadge.innerText = '[복귀 완료]';
        if (modalMsg) modalMsg.innerHTML = "<span style='color: #6c5ce7;'>복귀 완료</span>";
    }, 13500);

    setTimeout(() => {
        if (modal) modal.style.display = 'none';
        document.body.classList.remove('warning-flash');

        if (agvBadge) {
            agvBadge.innerText = '[대기 상태]';
            agvBadge.style.color = '#1e293b';
        }

        isRunning = false;
    }, 15500);
}
