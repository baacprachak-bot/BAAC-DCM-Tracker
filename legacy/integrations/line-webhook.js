// BAAC DCM Tracker — test Worker
// Adapted from the user-supplied Worker. Test with fictitious data only.
// Approved listing requires Apps Script action listApprovedCustomers; see integrations/README.md.

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "GET") {
      return new Response("BAAC DCM Tracker is running");
    }

    if (url.pathname !== "/webhook" || request.method !== "POST") {
      return new Response("Not Found", { status: 404 });
    }

    if (
      !env.LINE_CHANNEL_SECRET ||
      !env.LINE_CHANNEL_ACCESS_TOKEN ||
      !env.GOOGLE_SCRIPT_URL ||
      !env.DCM_API_KEY
    ) {
      return new Response("Server not configured", { status: 503 });
    }

    // Verify LINE signature against the raw request body before acknowledging.
    const signature = request.headers.get("x-line-signature");
    const body = await request.text();
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(env.LINE_CHANNEL_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
    const expected = new Uint8Array(mac);

    let actual;
    try {
      actual = Uint8Array.from(
        atob(signature || ""),
        (character) => character.charCodeAt(0)
      );
    } catch {
      return new Response("Invalid signature", { status: 401 });
    }

    let diff = expected.length ^ actual.length;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected[i] ^ (actual[i] ?? 0);
    }
    if (diff !== 0) {
      return new Response("Invalid signature", { status: 401 });
    }

    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // Keep the reply work alive after the webhook acknowledgement.
    // LINE reply tokens remain time-limited, so work should still finish promptly.
    ctx.waitUntil(
      handleEvents(payload, env).catch((error) => {
        console.error("Webhook background task failed:", error.message);
      })
    );
    return new Response("OK", { status: 200 });
  }
};

async function handleEvents(payload, env) {
  for (const event of payload.events || []) {
    if (
      event.type !== "message" ||
      event.message?.type !== "text" ||
      !event.replyToken
    ) {
      continue;
    }

    // Customer/document details must only be returned in a private OA chat.
    if (event.source?.type !== "user" || !event.source?.userId) continue;
    const documentId = event.message.text.trim();
    const registrationMatch = documentId.match(/^สมัคร\s+([A-Za-z0-9-]{3,20})$/);
    const approvalMatch = documentId.match(/^อนุมัติ\s+(\d{4,8})$/);
    let replyText;

    if (documentId === "TESTPING") {
      replyText = "ทดสอบ LINE ตอบกลับสำเร็จ";
    } else if (["รายการรออนุมัติ", "รออนุมัติ", "รายการอนุมัติแล้ว", "อนุมัติแล้ว"].includes(documentId)) {
const approved = documentId === "รายการอนุมัติแล้ว" || documentId === "อนุมัติแล้ว";
const listLabel = approved ? "รายการลูกค้าอนุมัติแล้ว" : "รายการลูกค้ารออนุมัติ";
const lineUserId = event.source?.userId;

if (!lineUserId) {
replyText = "ไม่พบข้อมูลบัญชี LINE";
} else {
try {
const response = await fetch(env.GOOGLE_SCRIPT_URL, {
method: "POST",
headers: {
"Content-Type": "text/plain;charset=UTF-8"
},
body: JSON.stringify({
key: env.DCM_API_KEY,
action: approved ? "listApprovedCustomers" : "listPendingCustomers",
lineUserId: lineUserId
}),
redirect: "follow",
signal: AbortSignal.timeout(10000)
});

if (!response.ok) {
throw new Error("HTTP " + response.status);
}

const result = await response.json();

if (!result.success) {
replyText = result.error === "PERMISSION_DENIED"
? "ไม่มีสิทธิ์ดู" + listLabel
: "ยังไม่สามารถดึงรายการได้ กรุณาติดต่อผู้ดูแลระบบ";
} else if (!Array.isArray(result.customers) || !Number.isInteger(result.count) || result.count < 0) {
replyText = "ข้อมูลรายการจากระบบไม่ถูกต้อง กรุณาติดต่อผู้ดูแลระบบ";
} else if (result.count === 0) {
replyText = approved ? "ไม่มีรายการลูกค้าอนุมัติแล้ว" : "ไม่มีรายการลูกค้ารออนุมัติ";
} else {
const lines = result.customers.slice(0, 20).map(
(customer, index) =>
(index + 1) + ". " +
customer.customerName +
"\nCIF: " + customer.cif
);

replyText =
listLabel + " (" + result.count + " ราย)\n\n" +
lines.join("\n\n") +
(result.count > 20 ? "\n\nแสดง 20 รายการแรก" : "") +
(approved ? "" : "\n\nพิมพ์ อนุมัติ ตามด้วย CIF เช่น อนุมัติ 123456");
}
} catch (error) {
console.error("Customer list lookup failed");
replyText = "เกิดข้อผิดพลาดในการเรียกข้อมูล";
}
}
} else if (approvalMatch) {
const lineUserId = event.source?.userId;
const cif = approvalMatch[1];

if (!lineUserId || event.source?.type !== "user") {
replyText = "กรุณาใช้คำสั่งนี้ในแชตส่วนตัวกับ LINE OA";
} else {
try {
const response = await fetch(env.GOOGLE_SCRIPT_URL, {
method: "POST",
headers: {
"Content-Type": "text/plain;charset=UTF-8"
},
body: JSON.stringify({
key: env.DCM_API_KEY,
action: "approveCustomer",
lineUserId,
cif
}),
redirect: "follow",
signal: AbortSignal.timeout(10000)
});

if (!response.ok) {
throw new Error("HTTP " + response.status);
}

const result = await response.json();

if (result.success) {
replyText =
"อนุมัติรายการสำเร็จ\n" +
"ลูกค้า: " + result.customerName + "\n" +
"CIF: " + result.cif + "\n" +
"สถานะ: APPROVED";
} else if (result.error === "PERMISSION_DENIED") {
replyText = "ไม่มีสิทธิ์อนุมัติรายการนี้";
} else if (result.error === "NO_PENDING_CUSTOMER") {
replyText = "ไม่พบรายการรออนุมัติของ CIF นี้";
} else {
replyText = "อนุมัติไม่สำเร็จ: " + result.error;
}
} catch (error) {
console.error("Customer approval failed:", error);
replyText = "เกิดข้อผิดพลาดในการอนุมัติ กรุณาลองใหม่";
}
}
    } else if (registrationMatch) {
      const lineUserId = event.source?.userId;
      const staffCode = registrationMatch[1].toUpperCase();

      if (!lineUserId) {
        replyText = 'ไม่สามารถระบุบัญชี LINE ได้ กรุณาแชตส่วนตัวกับ OA';
      } else {
        try {
          const response = await fetch(env.GOOGLE_SCRIPT_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=UTF-8" },
            body: JSON.stringify({
              key: env.DCM_API_KEY,
              action: "register",
              lineUserId,
              staffCode
            }),
            redirect: "follow",
            signal: AbortSignal.timeout(10000)
          });

          if (!response.ok) {
            throw new Error("Registration API HTTP " + response.status);
          }
          const result = await response.json();
          if (result.success) {
            replyText = "รับคำขอลงทะเบียนแล้ว\nสถานะ: รอ ADMIN อนุมัติ";
          } else if (result.error === "Already registered") {
            replyText = "บัญชี LINE นี้ลงทะเบียนไว้แล้ว";
          } else if (result.error === "Already pending") {
            replyText = "คุณมีคำขอลงทะเบียนที่รออนุมัติอยู่แล้ว";
          } else {
            replyText = "ไม่สามารถลงทะเบียนได้ กรุณาติดต่อ ADMIN";
          }
        } catch (error) {
          console.error("Registration failed:", error.message);
          replyText = "ระบบลงทะเบียนขัดข้อง กรุณาลองใหม่ภายหลัง";
        }
      }
} else if (/^บันทึกเอกสาร\s+\d{1,20}\s*\|\s*[^|]+\s*\|\s*[^|]+$/.test(documentId)) {
const parts = documentId.replace(/^บันทึกเอกสาร\s+/, "").split("|").map(s => s.trim());
const lineUserId = event.source?.userId;

if (!lineUserId || event.source?.type !== "user") {
replyText = "กรุณาใช้คำสั่งนี้ในแชตส่วนตัวกับ LINE OA";
} else {
try {
const response = await fetch(env.GOOGLE_SCRIPT_URL, {
method: "POST",
headers: { "Content-Type": "text/plain;charset=UTF-8" },
body: JSON.stringify({
key: env.DCM_API_KEY,
action: "registerDocument",
lineUserId,
documentId: parts[0],
documentType: parts[1],
purpose: parts[2]
}),
redirect: "follow",
signal: AbortSignal.timeout(10000)
});

if (!response.ok) throw new Error("HTTP " + response.status);

const result = await response.json();

replyText = result.success
? "บันทึกเอกสารสำเร็จ\nเลขเอกสาร: " + parts[0]
: "บันทึกไม่สำเร็จ: " + (result.error || "Unknown error");

} catch (error) {
console.error("Register document failed:", error.message);
replyText = "ระบบบันทึกเอกสารขัดข้อง กรุณาลองใหม่";
}
}    
} else if (/^ส่งชุด\s+\d{1,20}(?:[,\s]+\d{1,20})*$/.test(documentId)) {
const lineUserId = event.source?.userId;
const documentNumbers = documentId
.replace(/^ส่งชุด\s+/, "")
.split(/[,\s]+/)
.filter(Boolean);

if (!lineUserId || event.source?.type !== "user") {
replyText = "กรุณาใช้คำสั่งนี้ในแชตส่วนตัวกับ LINE OA";
} else {
try {
const response = await fetch(env.GOOGLE_SCRIPT_URL, {
method: "POST",
headers: {
"Content-Type": "text/plain;charset=UTF-8"
},
body: JSON.stringify({
key: env.DCM_API_KEY,
action: "createBatch",
lineUserId,
documentIds: documentNumbers
}),
redirect: "follow",
signal: AbortSignal.timeout(10000)
});

if (!response.ok) {
throw new Error("Batch API HTTP " + response.status);
}

const result = await response.json();

console.log("CREATE_BATCH_RESULT:", {
success: result.success,
error: result.error || null,
hasBatchId: Boolean(result.batchId)
});

if (result.success === true && result.batchId) {
replyText =
"สร้างชุดส่งสัญญาสำเร็จ\n" +
"เลขชุด: " + result.batchId + "\n" +
"เลขเอกสาร: " + documentNumbers.join(", ") + "\n" +
"สถานะ: รอผู้รับยืนยัน";
} else {
replyText =
"ไม่สามารถสร้างชุดส่งได้ กรุณาตรวจสอบสิทธิ์และสถานะเอกสาร";
}
} catch (error) {
console.error("Create batch failed:", error.message);
replyText = "ระบบส่งชุดสัญญาขัดข้อง กรุณาลองใหม่ภายหลัง";
}
}
} else if (/^รับชุด\s+DCM-\d{8}-[a-fA-F0-9]{8}$/.test(documentId)) {
const lineUserId = event.source?.userId;
const batchId = documentId.replace(/^รับชุด\s+/, "");

if (!lineUserId || event.source?.type !== "user") {
replyText = "กรุณารับชุดสัญญาผ่านแชตส่วนตัวกับ LINE OA";
} else {
try {
const response = await fetch(env.GOOGLE_SCRIPT_URL, {
method: "POST",
headers: {
"Content-Type": "text/plain;charset=UTF-8"
},
body: JSON.stringify({
key: env.DCM_API_KEY,
action: "confirmBatch",
lineUserId,
batchId
}),
redirect: "follow",
signal: AbortSignal.timeout(10000)
});

if (!response.ok) {
throw new Error("Confirm batch API HTTP " + response.status);
}

const result = await response.json();

if (result.success === true) {
replyText =
"✅ รับชุดสัญญาสำเร็จ\n" +
"เลขชุด: " + batchId + "\n" +
"จำนวนเอกสาร: " + result.count + "\n" +
"ผู้ถือปัจจุบัน: " + result.currentHolder;
} else {
replyText =
"ไม่สามารถรับชุดสัญญาได้ กรุณาตรวจสอบสิทธิ์หรือสถานะชุดส่ง";
}
} catch (error) {
console.error("Confirm batch failed:", error.message);
replyText = "ระบบรับชุดสัญญาขัดข้อง กรุณาลองใหม่ภายหลัง";
}
}

    } else if (!/^\d{1,20}$/.test(documentId)) {
      replyText = "กรุณาส่งเลขเอกสารเป็นตัวเลข เช่น 12345";
    } else {
      try {
        const apiUrl = new URL(env.GOOGLE_SCRIPT_URL);
        apiUrl.searchParams.set("id", documentId);
        apiUrl.searchParams.set("key", env.DCM_API_KEY);

        const response = await fetch(apiUrl.toString(), {
          method: "GET",
          redirect: "follow",
          signal: AbortSignal.timeout(10000)
        });
        console.log("Google fetch status:", response.status);
        if (!response.ok) {
          throw new Error("Google API HTTP " + response.status);
        }

        const result = await response.json();
        if (!result.success) {
          throw new Error("Google API returned an error");
        }

        if (!result.found || !result.document) {
          replyText = `ไม่พบเอกสารเลขที่ ${documentId}`;
        } else {
          const doc = result.document;
          // Never log customer/document contents.
          replyText =
            `📄 BAAC DCM Tracker\n\n` +
            `เลขเอกสาร: ${doc.id}\n` +
            `ประเภท: ${doc.type}\n` +
            `ผู้ถือปัจจุบัน: ${doc.holder}\n` +
            `กำลังรอผู้รับ: ${doc.pendingTo || "ไม่มีรายการรอรับ"}\n` +
            `สถานะ: ${doc.status}\n` +
            `วัตถุประสงค์: ${doc.purpose}\n` +
            `อัปเดตล่าสุด: ${doc.updated}`;
        }
      } catch (error) {
        console.error("Document lookup failed:", error.message);
        replyText = "ขออภัย ระบบค้นหาเอกสารขัดข้อง กรุณาลองใหม่";
      }
    }

    try {
      const replyResponse = await fetch(
        "https://api.line.me/v2/bot/message/reply",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`
          },
          body: JSON.stringify({
            replyToken: event.replyToken,
            messages: [{ type: "text", text: replyText.length > 4900 ? replyText.slice(0, 4800) + "\n…รายการยาวเกินแสดง กรุณาติดต่อผู้ดูแล" : replyText }]
          }),
          signal: AbortSignal.timeout(10000)
        }
      );
      console.log("LINE reply status:", replyResponse.status);
      if (!replyResponse.ok) {
        // Do not log token, request body or sensitive document details.
        console.error("LINE reply failed:", replyResponse.status);
      }
    } catch (error) {
      console.error("LINE reply request failed:", error.message);
    }
  }
}
