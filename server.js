const express = require("express");
const cors = require("cors");
const { poolPromise } = require("./db");
const app = express();

app.use(cors());
app.use(express.json());

// 개발 모드 확인
const isDevelopment = process.env.NODE_ENV !== 'production';

// DB 전역 직렬화 시스템 (완전 직렬화)
const dbQueue = [];
let isProcessingDbQueue = false;

async function processDbQueue() {
  while (dbQueue.length > 0) {
    isProcessingDbQueue = true;
    const { resolve, reject, fn } = dbQueue.shift();
    
    try {
      const result = await fn();
      resolve(result);
    } catch (error) {
      reject(error);
    }
  }
  
  isProcessingDbQueue = false;
}

function queueDbOperation(fn) {
  return new Promise((resolve, reject) => {
    dbQueue.push({ resolve, reject, fn });
    
    if (!isProcessingDbQueue) {
      processDbQueue().catch(err => {
        console.error('DB 큐 처리 오류:', err);
      });
    }
  });
}

// 테이블 캐시
let cachedTables = {
  saD: []
};

// LRU 캐시 (최근 조회된 상품)
const productCache = new Map();
const MAX_CACHE_SIZE = 1000;

// 서버 시작 시 테이블 캐시 초기화
async function initializeTableCache() {
  try {
const pool = await poolPromise;    
    // SaD_ 테이블 목록 조회 (SQL Server 2000 대응 - sysobjects 사용)
    const saDResult = await pool.request().query(`
      SELECT name
      FROM sysobjects
      WHERE xtype = 'U' AND name LIKE 'SaD_%'
      ORDER BY name DESC
    `);
    
    cachedTables.saD = saDResult.map(t => t.name);
    
    if (isDevelopment) {
      console.log(`테이블 캐시 초기화 완료:`);
      console.log(`  SaD 테이블: ${cachedTables.saD.length}개`);
    }
  } catch (error) {
    console.error('테이블 캐시 초기화 실패:', error);
  }
}

// LRU 캐시 관리
function setProductCache(barcode, data) {
  const trimmedBarcode = barcode.trim();
  if (MAX_CACHE_SIZE === 0) {
    return; // 캐시 비활성화 시 저장하지 않음
  }
  if (productCache.size >= MAX_CACHE_SIZE) {
    const firstKey = productCache.keys().next().value;
    productCache.delete(firstKey);
  }
  productCache.set(trimmedBarcode, data);
}

function getProductCache(barcode) {
  const trimmedBarcode = barcode.trim();
  const data = productCache.get(trimmedBarcode);
  if (data) {
    // 캐시 히트 시 재삽입으로 최신화
    productCache.delete(trimmedBarcode);
    productCache.set(trimmedBarcode, data);
  }
  return data;
}

// 캐시 자동 정리 기능 (1분마다 만료된 캐시 제거)
function startCacheCleanup() {
  setInterval(() => {
    // productCache는 LRU 방식이므로 별도 정리 불필요
  }, 60000); // 1분마다 실행
}

// 서버 상태 확인
app.get("/", (req, res) => {
  res.send("Sync Server Running");
});

// 현재 접속 DB 확인
app.get("/api/debug-db", async (req, res) => {
  try {
const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT
        DB_NAME() AS DBName,
        @@SERVERNAME AS ServerName,
        SYSTEM_USER AS LoginUser
    `);

    res.json(result[0]);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 특정 바코드 상품 조회
app.get("/api/price", async (req, res) => {
  const barcode = req.query.barcode;

  if (!barcode) {
    return res.status(400).json({
      error: "barcode 파라미터가 필요합니다."
    });
  }

  try {
const pool = await poolPromise;
    const result = await await pool.request().query(`
      `SELECT TOP 1 Barcode, goods_name, supply_price FROM Goods_Info WHERE Barcode = '${barcode}'`
    );

    res.json(result[0] || null);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 샘플 상품 확인
app.get("/api/sample", async (req, res) => {
  try {
const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT TOP 1 *
      FROM Goods_Info
      WHERE Barcode='000000020008'
    `);

    res.json(result[0] || null);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 상품 관련 테이블 자동 탐색
app.get("/api/analyze-tables", async (req, res) => {
  try {
const pool = await poolPromise;
    // 1. 모든 테이블 조회
    const tables = await pool.request().query(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `);

    const tablesWithData = [];

    // 2. 각 테이블의 행 수와 컬럼 목록 확인
    for (const table of tables) {
      try {
        const countResult = await pool.request().query(`SELECT COUNT(*) as count FROM [${table.TABLE_NAME}]`);
        const rowCount = countResult[0].count;

        if (rowCount > 0) {
          const columnsResult = await await pool.request().query(`
            SELECT COLUMN_NAME, DATA_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = '${table.TABLE_NAME}'
            ORDER BY ORDINAL_POSITION
          `);

          // 4. 키워드 관련 컬럼 확인
          const columns = columnsResult.map(c => c.COLUMN_NAME.toLowerCase());
          let score = 0;
          let matchedColumns = [];

          const keywords = ['goods_name', 'product', 'item', 'name', 'barcode', 'price', 'cost', 'supply', 'sale'];
          
          keywords.forEach(keyword => {
            const matched = columns.find(c => c.includes(keyword));
            if (matched) {
              score += 10;
              matchedColumns.push(keyword);
            }
          });

          // 행 수 점수
          score += Math.min(rowCount / 100, 20);

          // 테이블 이름 점수
          const tableName = table.TABLE_NAME.toLowerCase();
          if (tableName.includes('goods') || tableName.includes('product') || 
              tableName.includes('item') || tableName.includes('price')) {
            score += 15;
          }

          tablesWithData.push({
            tableName: table.TABLE_NAME,
            rowCount,
            columns: columnsResult,
            score,
            matchedColumns,
          });
        }
      } catch (error) {
        // 테이블 접근 불가능한 경우 무시
        continue;
      }
    }

    // 5. 점수 기준 정렬 후 상위 20개 추출
    tablesWithData.sort((a, b) => b.score - a.score);
    const top20 = tablesWithData.slice(0, 20);

    // 6. 각 후보 테이블의 샘플 데이터 TOP 3 조회
    const results = [];
    for (const table of top20) {
      try {
        const sampleResult = await await pool.request().query(`SELECT TOP 3 * FROM [${table.tableName}]`);
        results.push({
          ...table,
          sampleData: sampleResult,
        });
      } catch (error) {
        results.push({
          ...table,
          sampleData: [],
          error: error.message,
        });
      }
    }

    res.json({
      totalTables: tables.length,
      analyzedTables: tablesWithData.length,
      top20: results,
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 상품 통합 조회 API (정상가 + 행사가)
app.get("/api/product", async (req, res) => {
  const barcode = req.query.barcode?.trim();

  if (isDevelopment) {
    console.log(`/api/product 요청 수신: barcode=${barcode}`);
  }

  if (!barcode) {
    return res.status(400).json({
      error: "barcode 파라미터가 필요합니다."
    });
  }

  try {
    // LRU 캐시 확인 (barcode trim 적용)
    const trimmedBarcode = barcode.trim();
    const cached = getProductCache(trimmedBarcode);
    
    if (cached) {
      if (isDevelopment) {
        console.log(`캐시 히트: ${trimmedBarcode}`);
      }
      return res.json(cached);
    }

    // DB 전역 큐를 통한 DB 조회 (동시 접근 제한)
    const response = await queueDbOperation(async () => {
const pool = await poolPromise;
      // Goods 테이블에서 기본 정보 조회 (3파트 명명)
      const goodsResult = await await pool.request().query('
        `SELECT TOP 1 Barcode, G_Name, Sell_Pri FROM tips..Goods WHERE Barcode = '${trimmedBarcode}'`
      );

      if (!goodsResult || goodsResult.length === 0) {
        throw new Error("상품을 찾을 수 없습니다.");
      }

      const goods = goodsResult[0];
      const normalPrice = goods.Sell_Pri;

      // SaD_202606 테이블에서 최근 판매 기록 조회 (TSell_Pri 기반 행사가 계산)
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
      const currentMonthStr = `${currentYear}${currentMonth}`;
      const tableName = `tips..SaD_${currentMonthStr}`;

      let eventPrice = null;
      try {
        if (isDevelopment) {
          console.log(`테이블 조회: ${tableName}, Barcode: ${trimmedBarcode}`);
        }

        const saDResult = await pool.request().query(`
          SELECT TOP 1 Sell_Pri
          FROM ${tableName}
          WHERE Barcode = '${trimmedBarcode}'
          ORDER BY Sale_Date DESC, Sale_Time DESC
        `);

        if (saDResult && saDResult.length > 0) {
          const sad = saDResult[0];
          
          // 단순 가격 비교: 실제 판매가 < 정상가인 경우에만 행사가로 간주
          const salePrice = sad.Sell_Pri;
          eventPrice = salePrice < normalPrice ? salePrice : null;
          
          if (eventPrice !== null) {
            if (isDevelopment) {
              console.log(`행사 찾음: ${tableName}, Barcode: ${trimmedBarcode}, salePrice: ${eventPrice}, normalPrice: ${normalPrice}`);
              console.log("EVENT TRACE", {
                rawBarcode: barcode,
                trimmedBarcode: trimmedBarcode,
                eventPrice: eventPrice,
                source: "SaD"
              });
            }
          }
        }
      } catch (error) {
        // SaD 조회 실패 시 무시 (eventPrice는 null 유지)
        if (isDevelopment) {
          console.error(`SaD 조회 오류 (${tableName}):`, error.message);
        }
      }

      // 할인율 계산
      let discountRate = null;
      if (eventPrice !== null && eventPrice !== undefined && normalPrice > 0) {
        const calculatedRate = Math.round(((normalPrice - eventPrice) / normalPrice) * 100);
        // NaN 방지 및 음수 처리
        discountRate = isNaN(calculatedRate) || calculatedRate < 0 ? 0 : calculatedRate;
      }

      const result = {
        barcode: trimmedBarcode,
        name: goods.G_Name,
        normalPrice: normalPrice,
        eventPrice: eventPrice,
        discountRate: discountRate
      };

      // LRU 캐시 저장
      setProductCache(trimmedBarcode, result);

      return result;
    });

    res.json(response);

  } catch (err) {
    console.error('상품 조회 오류:', err);
    
    if (err.message === "상품을 찾을 수 없습니다.") {
      return res.status(404).json({
        error: "상품을 찾을 수 없습니다."
      });
    }
    
    // DB 장애 시 기존 캐시 데이터 fallback 시도
    const cached = getProductCache(barcode);
    if (cached) {
      console.log('상품 조회 DB 오류, 캐시 fallback 반환');
      return res.json(cached);
    }
    
    res.status(500).send(err.message);
  }
});

// 서버 시작
const PORT = process.env.PORT || 3001;

app.listen(PORT, async () => {
  console.log(`서버 실행됨: ${PORT}`);
  
  // 테이블 캐시 초기화
  await initializeTableCache();
  
  // 캐시 자동 정리 시작
  startCacheCleanup();
  
  if (isDevelopment) {
    console.log("캐시 자동 정리 기능 시작 (1분마다 실행)");
  }
});