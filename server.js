const express = require("express");
const cors = require("cors");
const { initDB, getDB, closeDB } = require("./db");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = 3001;

/**
 * 서버 시작
 */
async function startServer() {
  await initDB(); // 🔥 pool 1번만 생성

  app.listen(PORT, () => {
    console.log("서버 실행됨:", PORT);
  });
}

/**
 * 가격 API (핵심)
 */
app.get("/api/price", async (req, res) => {
  const { barcode } = req.query;

  if (!barcode) {
    return res.status(400).json({ error: "barcode missing" });
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
        discountRate: null
      });
    }

    const row = result[0];
    const Sell_Pri = row.Sell_Pri;
    const TSell_Pri = row.TSell_Pri;

    // Sell_Pri 유효성 검사
    if (!Sell_Pri || Sell_Pri <= 0) {
      return res.json({
        normalPrice: null,
        eventPrice: null,
        discountRate: null
      });
    }

    let eventPrice = null;
    let discountRate = null;

    // 행사 가격 계산: TSell_Pri > 0 && TSell_Pri < Sell_Pri
    if (TSell_Pri > 0 && TSell_Pri < Sell_Pri) {
      eventPrice = TSell_Pri;
      discountRate = Math.round((1 - TSell_Pri / Sell_Pri) * 100);
    }

    return res.json({
      normalPrice: Sell_Pri,
      eventPrice: eventPrice,
      discountRate: discountRate
    });

  } catch (err) {
    console.error("API ERROR:", err);

    // 🔥 절대 500으로 죽이지 않음 (프론트 보호)
    return res.json({
      normalPrice: null,
      eventPrice: null,
      discountRate: null,
      error: "db_error"
    });
  }
});

/**
 * 서버 종료 처리
 */
process.on("SIGINT", async () => {
  await closeDB();
  process.exit(0);
});

startServer();