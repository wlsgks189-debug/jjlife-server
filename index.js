const express = require('express');
const cron = require('node-cron');
const webpush = require('web-push');
const fetch = require('node-fetch');

const app = express();
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});
const PORT = process.env.PORT || 3000;

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

webpush.setVapidDetails(
  'mailto:wlsgks121@icqa.or.kr',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

async function getDoc(path) {
  const res = await fetch(`${FIRESTORE_URL}/${path}?key=${FIREBASE_API_KEY}`);
  return res.json();
}

function getField(doc, field) {
  const f = doc?.fields?.[field];
  if (!f) return null;
  return f.stringValue ?? f.integerValue ?? f.booleanValue ?? null;
}

async function getSubscriptions() {
  try {
    const doc = await getDoc('shared/pushSubscriptions');
    const jinhan = doc?.fields?.jinhan?.mapValue?.fields;
    const jungseop = doc?.fields?.jungseop?.mapValue?.fields;
    const result = {};
    if (jinhan?.endpoint?.stringValue) {
      result.jinhan = {
        endpoint: jinhan.endpoint.stringValue,
        keys: {
          p256dh: jinhan.p256dh?.stringValue,
          auth: jinhan.auth?.stringValue
        }
      };
    }
    if (jungseop?.endpoint?.stringValue) {
      result.jungseop = {
        endpoint: jungseop.endpoint.stringValue,
        keys: {
          p256dh: jungseop.p256dh?.stringValue,
          auth: jungseop.auth?.stringValue
        }
      };
    }
    return result;
  } catch (e) {
    console.error('구독 정보 로드 실패', e);
    return {};
  }
}

async function sendPush(subscription, title, body) {
  if (!subscription) return;
  try {
    await webpush.sendNotification(subscription, JSON.stringify({ title, body }));
    console.log(`알림 발송: ${title}`);
  } catch (e) {
    console.error('알림 발송 실패', e.message);
  }
}

function getKSTDateStr(offsetDays = 0) {
  const now = new Date();
  now.setHours(now.getHours() + 9);
  now.setDate(now.getDate() + offsetDays);
  return now.toISOString().split('T')[0];
}

// 매일 오전 9시 KST
cron.schedule('0 0 * * *', async () => {
  console.log('일정 D-1 알림 체크...');
  try {
    const subs = await getSubscriptions();
    const tomorrowStr = getKSTDateStr(1);
    const tripsDoc = await getDoc('shared/trips');
    const trips = tripsDoc?.fields?.list?.arrayValue?.values ?? [];
    for (const tripVal of trips) {
      const trip = tripVal.mapValue?.fields;
      if (!trip) continue;
      const itinerary = trip.itinerary?.mapValue?.fields ?? {};
      if (itinerary[tomorrowStr]) {
        const title = trip.title?.stringValue ?? '여행';
        await sendPush(subs.jinhan, `✈️ ${title} D-1!`, '내일 출발! 짐 챙겼는지 확인해요 🧳');
        await sendPush(subs.jungseop, `✈️ ${title} D-1!`, '내일 출발! 짐 챙겼는지 확인해요 🧳');
      }
    }
  } catch (e) {
    console.error('일정 알림 오류', e);
  }
});

// 매일 저녁 6시 KST
cron.schedule('0 9 * * *', async () => {
  console.log('짱구 산책 알림 체크...');
  try {
    const subs = await getSubscriptions();
    const todayStr = getKSTDateStr();
    const dogDoc = await getDoc('shared/dog');
    const lastWalk = getField(dogDoc, 'lastWalkDate');
    if (lastWalk !== todayStr) {
      await sendPush(subs.jinhan, '🐾 짱구 산책!', '오늘 아직 산책 안 했어요');
      await sendPush(subs.jungseop, '🐾 짱구 산책!', '오늘 아직 산책 안 했어요');
    }
  } catch (e) {
    console.error('산책 알림 오류', e);
  }
});

// 매일 저녁 9시 KST
cron.schedule('0 12 * * *', async () => {
  console.log('운동 알림 체크...');
  try {
    const subs = await getSubscriptions();
    const todayStr = getKSTDateStr();
    const jinhanDoc = await getDoc('users/jinhan');
    const jinhanAtt = jinhanDoc?.fields?.attendance?.mapValue?.fields ?? {};
    if (!jinhanAtt[todayStr]) {
      await sendPush(subs.jinhan, '🏋️ 오늘 운동!', '아직 출석 체크 안 했어요');
    }
    const jungseopDoc = await getDoc('users/jungseop');
    const jungseopAtt = jungseopDoc?.fields?.attendance?.mapValue?.fields ?? {};
    if (!jungseopAtt[todayStr]) {
      await sendPush(subs.jungseop, '🏋️ 오늘 운동!', '아직 출석 체크 안 했어요');
    }
  } catch (e) {
    console.error('운동 알림 오류', e);
  }
});

app.get('/', (req, res) => res.send('JJlife 알림 서버 동작중 ✅'));

app.listen(PORT, () => console.log(`서버 시작 포트 ${PORT}`));

app.get('/test', async (req, res) => {
  try {
    const subs = await getSubscriptions();
    const uid = req.query.uid || 'jinhan';
    const sub = subs[uid];
    if (!sub) return res.json({ error: '구독 정보 없음' });
    await sendPush(sub, '🧪 테스트 알림!', 'JJlife 알림 연결 성공 🎉');
    res.json({ ok: true, uid });
  } catch(e) {
    res.json({ error: e.message });
  }
});
