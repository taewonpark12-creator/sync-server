const express = require("express");
const cors = require("cors");
const { connectDB, closeDB } = require("./db");

const app = express();

app.use(cors());
app.use(express.json());

/**
 * 상품 가격 조회 API
 */
app.get("/api/price", async (req, res) => {
  const barcode = req.query.barcode;

  if (!barcode) {
    return res.status(400).json({ error: "barcode 필요" });
  }

  try {
    const conn = await connectDB();

    // Goods 테이블에서 기본 정보 조회
    const goodsResult = await conn.query(`
      SELECT TOP 1 
        BarCode,
        G_Name,
        Sell_Pri
      FROM Goods
      WHERE BarCode = ?
    `, [barcode]);

    const goodsRows = Array.isArray(goodsResult) ? goodsResult : goodsResult?.rows || [];
    const goodsRow = goodsRows[0];

    if (!goodsRow) {
      await closeDB(conn);
      return res.status(404).json({ error: "상품 없음" });
    }

    // SaD_202606 테이블에서 최근 판매 기록 조회
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
    const currentMonthStr = `${currentYear}${currentMonth}`;
    const tableName = `tips..SaD_${currentMonthStr}`;

    let eventPrice = null;
    let discountRate = null;

    try {
      const saDResult = await conn.query(`
        SELECT TOP 1 
          Sell_Pri
        FROM ${tableName}
        WHERE Barcode = ?
        ORDER BY Sale_Date DESC, Sale_Time DESC
      `, [barcode]);

      const saDRows = Array.isArray(saDResult) ? saDResult : saDResult?.rows || [];
      const saDRow = saDRows[0];

      if (saDRow) {
        // eventPrice 계산: salePrice < normalPrice
        const normalPrice = goodsRow.Sell_Pri;
        const salePrice = saDRow.Sell_Pri;
        eventPrice = salePrice < normalPrice ? salePrice : null;
        
        if (eventPrice !== null) {
          discountRate = Math.round(((normalPrice - eventPrice) / normalPrice) * 100);
        }
      }
    } catch (saDError) {
      // SaD 조회 실패 시 무시 (eventPrice는 null 유지)
      console.error(`SaD 조회 오류 (${tableName}):`, saDError.message);
    }

    res.json({
      normalPrice: goodsRow.Sell_Pri,
      eventPrice: eventPrice,
      discountRate: discountRate
    });

    await closeDB(conn);

  } catch (err) {
    console.error("API ERROR:", err);
    console.error("Error details:", {
      message: err.message,
      stack: err.stack,
      barcode: barcode
    });
    res.status(500).send(err.message);
  }
});

/**
 * 서버 실행
 */
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`서버 실행됨: ${PORT}`);
});