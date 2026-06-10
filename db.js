const odbc = require("odbc");

const connectionString =
"Driver={SQL Server};Server=192.168.10.111,18973;Database=tips;Uid=sa;Pwd=0888TipS!@;";

async function connectDB() {
  // 요청마다 새로운 connection 생성
  const db = await odbc.connect(connectionString);
  console.log("DB Connected");
  return db;
}

async function closeDB(db) {
  if (db) {
    await db.close();
    console.log("DB Closed");
  }
}

module.exports = { connectDB, closeDB };