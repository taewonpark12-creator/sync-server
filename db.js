const sql = require("mssql");

const config = {
  user: "sa",
  password: "0888TipS!@",
  server: "192.168.10.111",
  port: 18973,
  database: "tips",
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

// 연결 풀 (중요)
const poolPromise = new sql.ConnectionPool(config)
  .connect()
  .then(pool => {
    console.log("DB Connected");
    return pool;
  })
  .catch(err => console.log("DB Connection Failed", err));

module.exports = {
  sql,
  poolPromise
};