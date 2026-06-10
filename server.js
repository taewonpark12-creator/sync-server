const express = require("express");
const cors = require("cors");
const { initDB, getDB, closeDB } = require("./db");

const app = express();

// =======================
// Middleware
// =======================
app.use(cors()); // 필요하면 origin 제한 가능
app.use(express.json());

const PORT = 3001;

// =======================
// 서버 시작 (DB pool 1회 생성)
// =======================
async function startServer() {
  try {
    await initDB();
    console.log("DB Connected");

    app.listen(PORT, () => {
      console.log("서버 실행됨:", PORT);
    });
  } catch (err) {
    console.error("서버 시작 실패:", err);
  }
}

// =======================
// 가격 API
// =======================
app.get("/api/price", async (req, res) => {
  const { barcode } = req.query;

  if (!barcode) {
    return res.status(400).json({
      error: "barcode missing",
      normalPrice: null,
      eventPrice: null,
      discountRate: null,
    });
  }

  try {
    const db = getDB();

    const sql = `
      SELECT TOP 1
        Sell_Pri,
        TSell_Pri
      FROM SaD_202606
      WHERE Barcode = ?
    `;

    const result = await db.query(sql, [barcode]);

    if (!result || result.length === 0) {
      return res.json({
        normalPrice: null,
        eventPrice: null,
        discountRate: null,
      });
    }

    const row = result[0];

    // =======================
    // 안전한 숫자 변환
    // =======================
    const Sell_Pri = Number(row.Sell_Pri);
    const TSell_Pri = Number(row.TSell_Pri);

    // 정상가 체크
    if (!Sell_Pri || Sell_Pri <= 0) {
      return res.json({
        normalPrice: null,
        eventPrice: null,
        discountRate: null,
      });
    }

    let eventPrice = null;
    let discountRate = null;

    // =======================
    // 행사 가격 계산
    // =======================
    if (
      TSell_Pri &&
      TSell_Pri > 0 &&
      TSell_Pri < Sell_Pri
    ) {
      eventPrice = TSell_Pri;
      discountRate = Math.round((1 - TSell_Pri / Sell_Pri) * 100);
    }

    return res.json({
      normalPrice: Sell_Pri,
      eventPrice,
      discountRate,
    });

  } catch (err) {
    console.error("API ERROR:", err);

    // 서버 절대 죽이지 않음
    return res.json({
      normalPrice: null,
      eventPrice: null,
      discountRate: null,
      error: "db_error",
    });
  }
});

// =======================
// 서버 종료 처리
// =======================
process.on("SIGINT", async () => {
  console.log("서버 종료 중...");
  await closeDB();
  process.exit(0);
});

// =======================
// 실행
// =======================
startServer();