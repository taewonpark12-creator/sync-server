const odbc = require("odbc");

const connectionString =
  "Driver={SQL Server};Server=192.168.10.111,18973;Database=tips;Uid=sa;Pwd=0888TipS!@;";

// 🔥 핵심: pool 생성
let pool;

/**
 * DB Pool 초기화 (서버 시작 시 1번만 실행)
 */
async function initDB() {
  if (!pool) {
    pool = await odbc.pool(connectionString, {
      min: 1,   // 최소 연결
      max: 10   // 최대 연결 (동시 요청 처리)
    });

    console.log("DB Pool Connected");
  }

  return pool;
}

/**
 * DB Pool 가져오기
 */
function getDB() {
  if (!pool) {
    throw new Error("DB not initialized. Call initDB first.");
  }
  return pool;
}

/**
 * 서버 종료 시 정리
 */
async function closeDB() {
  if (pool) {
    await pool.close();
    console.log("DB Pool Closed");
  }
}

module.exports = {
  initDB,
  getDB,
  closeDB
};