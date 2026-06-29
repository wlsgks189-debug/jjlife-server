const express = require('express');
const cron = require('node-cron');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

const API_KEY = process.env.FIREBASE_API_KEY;
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FCM_SERVER_KEY = process.env.FCM_SERVER_KEY;

const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

async function getDoc(path) {
  const res = await fetch(`${FIRESTORE_URL}/${path}?key=${API_KEY}`);
  return res.json();
}

function getField(doc, field) {
  const f = doc?.fields?.[field];
  if (!f) return null;
  return f.stringValue ?? f.integerValue ?? f.booleanValue ?? f.arrayValue ?? null;
}

async function sendPush(token, title, body) {
  if (!token || !FCM_SERVER_KEY) return;
  await fetch('https://fcm.googleapis.com/fcm/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `key=${FCM_SERVER_KEY}`
    },
    body: JSON.stringify({
      to: token,
      notification: { title, body },
      priority: 'high'
    })
  });
  console.log(`알림 발송: ${title}`);
}

async function getTokens() {
  try {
    const doc = await getDoc('shared/fcmTokens');
    const jinhan = getField(doc, 'jinhan');
    const jungseop = getField(doc, 'jungseop');
    return { jinhan, jungseop };
  } catch (e) {
    console.error('토큰 로드 실패', e);
    return {};
  }
}

// 매일 오전 9시 (KST) = UTC 0시
cron.schedule('0 0 * * *', async () => {
  console.log('일정 알림 체크...');
  try {
    const { jinhan, jungseop } = await getTokens();
    const today = new Date();
    today.setHours(today.getHours() + 9); // KST
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const tripsDoc = await getDoc('shared/trips');
    const trips = tripsDoc?.fields?.list?.arrayValue?.values ?? [];

    for (const tripVal of trips) {
      const trip = tripVal.mapValue?.fields;
      if (!trip) continue;
      const itinerary = trip.itinerary?.mapValue?.fields ?? {};
      if (itinerary[tomorrowStr]) {
        const title = trip.title?.stringValue ?? '여행';
        if (jinhan) await sendPush(jinhan, `✈️ ${title} D-1!`, '내일 출발이에요! 짐 챙겼는지 확인해봐요 🧳');
        if (jungseop) await sendPush(jungseop, `✈️ ${title} D-1!`, '내일 출발이에요! 짐 챙겼는지 확인해봐요 🧳');
      }
    }
  } catch (e) {
    console.error('일정 알림 오류', e);
  }
});

// 매일 저녁 6시 (KST) = UTC 9시
cron.schedule('0 9 * * *', async () => {
  console.log('짱구 산책 알림 체크...');
  try {
    const { jinhan, jungseop } = await getTokens();
    const today = new Date();
    today.setHours(today.getHours() + 9);
    const dateStr = today.toISOString().split('T')[0];

    const dogDoc = await getDoc(`shared/dog`);
    const lastWalk = getField(dogDoc, 'lastWalkDate');

    if (lastWalk !== dateStr) {
      if (jinhan) await sendPush(jinhan, '🐾 짱구 산책!', '오늘 아직 산책 안 했어요');
      if (jungseop) await sendPush(jungseop, '🐾 짱구 산책!', '오늘 아직 산책 안 했어요');
    }
  } catch (e) {
    console.error('산책 알림 오류', e);
  }
});

// 매일 저녁 9시 (KST) = UTC 12시
cron.schedule('0 12 * * *', async () => {
  console.log('운동 알림 체크...');
  try {
    const { jinhan, jungseop } = await getTokens();
    const today = new Date();
    today.setHours(today.getHours() + 9);
    const dateStr = today.toISOString().split('T')[0];

    // 진한 운동 체크
    const jinhanDoc = await getDoc('users/jinhan');
    const jinhanAtt = jinhanDoc?.fields?.attendance?.mapValue?.fields ?? {};
    if (!jinhanAtt[dateStr] && jinhan) {
      await sendPush(jinhan, '🏋️ 오늘 운동!', '아직 출석 체크 안 했어요');
    }

    // 정섭 운동 체크
    const jungseopDoc = await getDoc('users/jungseop');
    const jungseopAtt = jungseopDoc?.fields?.attendance?.mapValue?.fields ?? {};
    if (!jungseopAtt[dateStr] && jungseop) {
      await sendPush(jungseop, '🏋️ 오늘 운동!', '아직 출석 체크 안 했어요');
    }
  } catch (e) {
    console.error('운동 알림 오류', e);
  }
});

app.get('/', (req, res) => res.send('JJlife 알림 서버 동작중 ✅'));

app.listen(PORT, () => console.log(`서버 시작 포트 ${PORT}`));
