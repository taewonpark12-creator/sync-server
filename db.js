const odbc = require("odbc");

const connectionString =
  "Driver={SQL Server};Server=192.168.10.111,18973;Database=tips;Uid=sa;Pwd=0888TipS!@;";

// 단일 연결 사용 (ODBC 동시 쿼리 충돌 방지)
const db = odbc.connect(connectionString);

module.exports = db;