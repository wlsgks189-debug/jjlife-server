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
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  kst.setUTCDate(kst.getUTCDate() + offsetDays);
  return kst.toISOString().split('T')[0];
}

// 매일 오전 9시 KST = UTC 0시
cron.schedule('0 0 * * *', async () => {
  console.log('오전 9시 종합 알림 체크...');
  try {
    const subs = await getSubscriptions();
    const todayStr = getKSTDateStr();
    const tomorrowStr = getKSTDateStr(1);

    // 여행 D-1 체크
   const tripsDoc = await getDoc('shared/data');
const trips = tripsDoc?.fields?.trips?.arrayValue?.values ?? [];
    for (const tripVal of trips) {
      const trip = tripVal.mapValue?.fields;
      if (!trip) continue;
      const itinerary = trip.itinerary?.mapValue?.fields ?? {};
      if (itinerary[tomorrowStr]) {
        const title = trip.title?.stringValue ?? '여행';
        await sendPush(subs.jinhan, `✈️ ${title} D-1!`, '내일 출발! 짐 챙겼는지 확인해요 🧳');
        await sendPush(subs.jungseop, `✈️ ${title} D-1!`, '내일 출발! 짐 챙겼는지 확인해요 🧳');
      }
      // 오늘 여행 일정
      if (itinerary[todayStr]) {
        const title = trip.title?.stringValue ?? '여행';
        const items = itinerary[todayStr]?.arrayValue?.values ?? [];
        const summary = items.map(i => i.mapValue?.fields?.title?.stringValue).filter(Boolean).join(', ');
        await sendPush(subs.jinhan, `✈️ 오늘 ${title} 일정!`, summary || '오늘 여행 일정이 있어요');
        await sendPush(subs.jungseop, `✈️ 오늘 ${title} 일정!`, summary || '오늘 여행 일정이 있어요');
      }
    }

    // 짱구 산책 체크
    const dogDoc = await getDoc('shared/dog');
    const lastWalk = getField(dogDoc, 'lastWalkDate');
    if (lastWalk !== todayStr) {
      await sendPush(subs.jinhan, '🐾 짱구 산책!', '오늘 아직 산책 안 했어요');
      await sendPush(subs.jungseop, '🐾 짱구 산책!', '오늘 아직 산책 안 했어요');
    }

    // 운동 체크
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

    // 공유 일정
    const eventsDoc = await getDoc('shared/data');
const events = eventsDoc?.fields?.events?.arrayValue?.values ?? [];
    const todayEvents = events.filter(e => {
      const d = e.mapValue?.fields?.date?.stringValue;
      return d === todayStr;
    });
    const sharedEvents = todayEvents.filter(e => e.mapValue?.fields?.isShared?.booleanValue === true);
    if (sharedEvents.length > 0) {
      const titles = sharedEvents.map(e => e.mapValue?.fields?.title?.stringValue).filter(Boolean).join(', ');
      await sendPush(subs.jinhan, '📅 오늘 공유 일정', titles);
      await sendPush(subs.jungseop, '📅 오늘 공유 일정', titles);
    }

    // 진한 개인 일정
    const jinhanEvents = todayEvents.filter(e => {
      const author = e.mapValue?.fields?.author?.stringValue;
      const isShared = e.mapValue?.fields?.isShared?.booleanValue;
      return author === 'jinhan' && !isShared;
    });
    if (jinhanEvents.length > 0) {
      const titles = jinhanEvents.map(e => e.mapValue?.fields?.title?.stringValue).filter(Boolean).join(', ');
      await sendPush(subs.jinhan, '📅 오늘 내 일정', titles);
    }

    // 정섭 개인 일정
    const jungseopEvents = todayEvents.filter(e => {
      const author = e.mapValue?.fields?.author?.stringValue;
      const isShared = e.mapValue?.fields?.isShared?.booleanValue;
      return author === 'jungseop' && !isShared;
    });
    if (jungseopEvents.length > 0) {
      const titles = jungseopEvents.map(e => e.mapValue?.fields?.title?.stringValue).filter(Boolean).join(', ');
      await sendPush(subs.jungseop, '📅 오늘 내 일정', titles);
    }

  } catch (e) {
    console.error('오전 9시 알림 오류', e);
  }
});

// 매일 저녁 6시 KST = UTC 9시
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

// 매일 저녁 9시 KST = UTC 12시
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

// Render 슬립 방지 자체 ping (10분마다)
setInterval(async () => {
  try {
    await fetch(`https://jjlife-server.onrender.com/`);
    console.log('self-ping ok');
  } catch(e) {
    console.error('self-ping 실패', e.message);
  }
}, 10 * 60 * 1000);

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

app.get('/test-all', async (req, res) => {
  try {
    const subs = await getSubscriptions();
    await sendPush(subs.jinhan, '🧪 테스트 알림!', 'JJlife 알림 연결 성공 🎉');
    await sendPush(subs.jungseop, '🧪 테스트 알림!', 'JJlife 알림 연결 성공 🎉');
    res.json({ ok: true });
  } catch(e) {
    res.json({ error: e.message });
  }
});
