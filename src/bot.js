import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { Bot, InlineKeyboard, InputFile, session, webhookCallback } from 'grammy';

const {
  BOT_TOKEN,
  CHANNEL_ID,
  ADMIN_ID,
  SITE_URL = 'https://go-3-d.online',
  CONTACT_TELEGRAM = 'https://t.me/lenin321',
  BOT_LINK = 'https://t.me/go3d_bot',
} = process.env;

if (!BOT_TOKEN) {
  console.error('Нет BOT_TOKEN в .env');
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);

// ── Пути к ассетам ──────────────────────────────────────────────
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BANNER = path.join(ROOT, 'assets', 'start-banner.png');
const QR = path.join(ROOT, 'assets', 'bot-qr.png');
const STATS_FILE = path.join(ROOT, 'data', 'stats.json');

// ── Статистика заявок (лёгкое JSON-хранилище) ───────────────────
function loadStats() {
  try {
    return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  } catch {
    return { total: 0, byDate: {}, byType: {} };
  }
}
function recordLead(typeLabel) {
  const s = loadStats();
  const day = new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' });
  s.total = (s.total || 0) + 1;
  s.byDate[day] = (s.byDate[day] || 0) + 1;
  s.byType[typeLabel] = (s.byType[typeLabel] || 0) + 1;
  try {
    fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true });
    fs.writeFileSync(STATS_FILE, JSON.stringify(s, null, 2));
  } catch (e) {
    console.warn('Не записал статистику:', e.message);
  }
}
function isAdmin(ctx) {
  return ADMIN_ID && String(ctx.from?.id) === String(ADMIN_ID);
}

// ── Память диалога ──────────────────────────────────────────────
function initial() {
  return { step: 'idle', data: { type: '', about: '', visual: '', photos: [], contact: '' } };
}
bot.use(session({ initial }));

const TYPES = {
  landing: 'Лендинг / визитка',
  corp: 'Корпоративный сайт',
  shop: 'Интернет-магазин',
  say: 'Скажи красиво · сайт-признание',
  other: 'Другое',
};

// Второй вопрос подстраивается под формат
const ABOUT_Q = {
  say:
    '<b>② Шаг 2 из 4</b>\nРасскажи про неё: как зовут, какой повод и что хочешь сказать. ' +
    'Можно пару строк — соберу красиво.',
  _default: '<b>② Шаг 2 из 4</b>\nРасскажи в двух словах: чем занимаешься и что за сайт хочешь?',
};

// ── Помощники ───────────────────────────────────────────────────
function userTag(from) {
  if (from.username) return '@' + from.username;
  return `${from.first_name || ''} ${from.last_name || ''}`.trim() || `id${from.id}`;
}

// Кликабельная ссылка на Telegram человека: @ник или deep-link по id.
function userLink(from) {
  if (from.username) return '@' + from.username;
  const name = `${from.first_name || ''} ${from.last_name || ''}`.trim() || 'профиль';
  return `<a href="tg://user?id=${from.id}">${name}</a>`;
}

async function sendBrief(ctx) {
  const d = ctx.session.data;
  const from = ctx.from;
  const when = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
  const card =
    '🆕 <b>НОВАЯ ЗАЯВКА · сайт</b>\n' +
    '─────────────────────\n' +
    `<b>Тип:</b>     ${d.type || '—'}\n` +
    `<b>Проект:</b>  ${d.about || '—'}\n` +
    `<b>Визуал:</b>  ${d.visual || '—'}\n` +
    `<b>Контакт:</b> ${d.contact || userTag(from)}\n` +
    `<b>От:</b>      ${userTag(from)} (id${from.id})\n` +
    `<b>Время:</b>   ${when} МСК\n` +
    '─────────────────────\n' +
    `<b>Фото:</b> ${d.photos.length} шт`;

  const dest = CHANNEL_ID || ADMIN_ID;
  if (!dest) {
    console.warn('Некуда слать заявку: пустые CHANNEL_ID и ADMIN_ID');
    return;
  }

  await bot.api.sendMessage(dest, card, { parse_mode: 'HTML' });

  // Фото — альбомами по 10 (лимит Telegram)
  for (let i = 0; i < d.photos.length; i += 10) {
    const chunk = d.photos.slice(i, i + 10).map((file_id) => ({ type: 'photo', media: file_id }));
    if (chunk.length) await bot.api.sendMediaGroup(dest, chunk);
  }
}

// ── /start ──────────────────────────────────────────────────────
bot.command('start', async (ctx) => {
  ctx.session = initial();
  console.log(`/start от ${userTag(ctx.from)} — твой ADMIN_ID = ${ctx.from.id}`);

  // Глубокая ссылка с сайта: /start say → сразу формат «Скажи красиво»
  const payload = (ctx.match || '').trim();
  if (payload === 'say') {
    ctx.session.data.type = TYPES.say;
    ctx.session.step = 'about';
    await ctx.reply(
      'Привет! Делаем тебе <b>«Скажи красиво»</b> — персональный сайт-признание по ссылке ✨\n\n' +
        ABOUT_Q.say,
      { parse_mode: 'HTML' },
    );
    return;
  }

  const kb = new InlineKeyboard().text('Поехали 🚀', 'brief:start');
  const caption =
    'Привет! Я бот <b>3D</b> — соберу бриф на твой сайт за пару минут, ' +
    'и Стас вернётся с ценой и сроком.\n\n' +
    '3D — это <b>3 Days</b>: сайт за 3 дня или деньги назад 🤝\n\nПоехали?';
  try {
    if (fs.existsSync(BANNER)) {
      await ctx.replyWithPhoto(new InputFile(BANNER), {
        caption,
        parse_mode: 'HTML',
        reply_markup: kb,
      });
      return;
    }
  } catch (e) {
    console.warn('Не отправил баннер:', e.message);
  }
  await ctx.reply(caption, { parse_mode: 'HTML', reply_markup: kb });
});

// ── /admin — панель управления (только для админа) ──────────────
bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const kb = new InlineKeyboard()
    .text('📊 Статистика', 'admin:stats').row()
    .text('🔗 Ссылка для клиентов', 'admin:link').row()
    .text('🧾 QR-код бота', 'admin:qr').row()
    .url('🌐 Открыть сайт', SITE_URL);
  await ctx.reply('🛠 <b>Панель управления 3D</b>\nВыбери раздел:', {
    parse_mode: 'HTML',
    reply_markup: kb,
  });
});

bot.callbackQuery('admin:stats', async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isAdmin(ctx)) return;
  const s = loadStats();
  const today = new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' });
  const todayN = s.byDate?.[today] || 0;
  const byType = Object.entries(s.byType || {})
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `   • ${t}: <b>${n}</b>`)
    .join('\n');
  const lastDays = Object.entries(s.byDate || {})
    .slice(-7)
    .map(([d, n]) => `   ${d}: <b>${n}</b>`)
    .join('\n');
  const text =
    '📊 <b>Статистика заявок</b>\n' +
    '─────────────────────\n' +
    `Всего: <b>${s.total || 0}</b>\n` +
    `Сегодня: <b>${todayN}</b>\n\n` +
    `<b>По типам:</b>\n${byType || '   —'}\n\n` +
    `<b>Последние дни:</b>\n${lastDays || '   —'}`;
  await ctx.reply(text, { parse_mode: 'HTML' });
});

bot.callbackQuery('admin:link', async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isAdmin(ctx)) return;
  await ctx.reply(
    '🔗 <b>Ссылка на бота для клиентов:</b>\n' +
      `<code>${BOT_LINK}</code>\n\n` +
      'Кидай её в сторис, визитку или переписку — клиент жмёт, и бриф собирается сам.',
    { parse_mode: 'HTML' },
  );
});

bot.callbackQuery('admin:qr', async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isAdmin(ctx)) return;
  try {
    if (fs.existsSync(QR)) {
      await ctx.replyWithPhoto(new InputFile(QR), {
        caption: '🧾 QR-код бота — наведи камеру, открывается чат.',
      });
      return;
    }
  } catch (e) {
    console.warn('Не отправил QR:', e.message);
  }
  await ctx.reply(`QR пока не сгенерирован. Ссылка: ${BOT_LINK}`);
});

// ── /idea — личная копилка для админа ───────────────────────────
bot.command('idea', async (ctx) => {
  if (ADMIN_ID && String(ctx.from.id) !== String(ADMIN_ID)) return;
  ctx.session.step = 'idea';
  await ctx.reply('💡 Режим идей. Кидай текст/фото — сложу в канал. /stop чтобы выйти.');
});
bot.command('stop', async (ctx) => {
  ctx.session = initial();
  await ctx.reply('Ок, вышел из режима. /start — начать бриф заново.');
});

// ── Шаг 1: тип сайта ────────────────────────────────────────────
bot.callbackQuery('brief:start', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session = initial();
  ctx.session.step = 'type';
  const kb = new InlineKeyboard()
    .text(TYPES.landing, 'type:landing').row()
    .text(TYPES.corp, 'type:corp').row()
    .text(TYPES.shop, 'type:shop').row()
    .text(TYPES.say, 'type:say').row()
    .text(TYPES.other, 'type:other');
  // Баннер — это фото, текст у него не редактируется: убираем кнопку и шлём новый вопрос
  try {
    await ctx.editMessageReplyMarkup();
  } catch {
    /* кнопка уже убрана — не страшно */
  }
  await ctx.reply('<b>① Шаг 1 из 4</b>\nЧто за сайт нужен?', { parse_mode: 'HTML', reply_markup: kb });
});

bot.callbackQuery(/^type:(.+)$/, async (ctx) => {
  const key = ctx.match[1];
  await ctx.answerCallbackQuery();
  if (key === 'other') {
    ctx.session.step = 'type_other';
    await ctx.editMessageText('Опиши, какой сайт нужен:');
    return;
  }
  ctx.session.data.type = TYPES[key] || key;
  ctx.session.step = 'about';
  await ctx.editMessageText(`✅ Сайт: ${ctx.session.data.type}`);
  await ctx.reply(ABOUT_Q[key] || ABOUT_Q._default, { parse_mode: 'HTML' });
});

// ── Пропустить визуал ───────────────────────────────────────────
bot.callbackQuery('visual:skip', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.data.visual = '—';
  goToPhotos(ctx);
  await ctx.editMessageText('✅ Стиль: на твой вкус');
  await askPhotos(ctx);
});

// ── Готово с фото ───────────────────────────────────────────────
bot.callbackQuery('photos:done', async (ctx) => {
  await ctx.answerCallbackQuery();
  const n = ctx.session.data.photos.length;
  await ctx.editMessageText(`✅ Фото: ${n} шт`);
  // Контакт берём автоматически из Telegram — лишний вопрос не задаём.
  ctx.session.data.contact = userLink(ctx.from);
  await finish(ctx);
});

function goToPhotos(ctx) {
  ctx.session.step = 'photos';
  ctx.session.data.photos = [];
}
async function askPhotos(ctx) {
  const isSay = ctx.session.data.type === TYPES.say;
  const q = isSay
    ? '<b>④ Шаг 4 из 4</b>\nСкинь её фото (1–2) — добавлю на сайт-признание. Как закончишь — жми «Готово». ' +
      'Нет под рукой — тоже жми «Готово», пришлёшь потом.'
    : '<b>④ Шаг 4 из 4</b>\nСкинь фото: логотип, фото бизнеса или скрины сайтов, которые нравятся. ' +
      'Можно несколько. Как закончишь — жми «Готово».';
  await ctx.reply(q, { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('Готово ✅', 'photos:done') });
}

async function finish(ctx) {
  await sendBrief(ctx);
  recordLead(ctx.session.data.type || '—');
  const d = ctx.session.data;
  const summary =
    '✅ <b>Бриф собран и улетел Стасу</b>\n' +
    '━━━━━━━━━━━━━━━━━\n' +
    `🗂 <b>Сайт:</b> ${d.type || '—'}\n` +
    `📝 <b>Проект:</b> ${d.about || '—'}\n` +
    `🎨 <b>Стиль:</b> ${d.visual || '—'}\n` +
    `🖼 <b>Фото:</b> ${d.photos.length} шт\n` +
    `📲 <b>Контакт:</b> ${d.contact || '—'}\n` +
    '━━━━━━━━━━━━━━━━━\n' +
    'Стас напишет тебе совсем скоро.\n' +
    '🤝 Гарантия: лендинг за 3 дня или деньги назад.';
  ctx.session = initial();
  const kb = new InlineKeyboard()
    .url('🌐 Открыть сайт', SITE_URL)
    .url('💬 Написать Стасу', CONTACT_TELEGRAM);
  await ctx.reply(summary, { parse_mode: 'HTML', reply_markup: kb });
}

// ── Фото-сообщения ──────────────────────────────────────────────
bot.on('message:photo', async (ctx) => {
  const s = ctx.session;
  if (s.step === 'idea') {
    const dest = CHANNEL_ID || ADMIN_ID;
    if (dest) {
      const photo = ctx.message.photo.at(-1).file_id;
      await bot.api.sendPhoto(dest, photo, { caption: '💡 Идея' });
    }
    await ctx.reply('Сохранил 💡');
    return;
  }
  if (s.step !== 'photos') return;
  const best = ctx.message.photo.at(-1).file_id;
  s.data.photos.push(best); // тихо копим, не спамим на каждое фото
});

// ── Текстовые сообщения по шагам ────────────────────────────────
bot.on('message:text', async (ctx) => {
  const s = ctx.session;
  const text = ctx.message.text.trim();

  if (s.step === 'idea') {
    const dest = CHANNEL_ID || ADMIN_ID;
    if (dest) await bot.api.sendMessage(dest, `💡 Идея:\n${text}`);
    await ctx.reply('Сохранил 💡');
    return;
  }

  switch (s.step) {
    case 'type_other':
      s.data.type = text;
      s.step = 'about';
      await ctx.reply('<b>② Шаг 2 из 4</b>\nРасскажи в двух словах: чем занимаешься и что за сайт хочешь?', { parse_mode: 'HTML' });
      break;
    case 'about':
      s.data.about = text;
      s.step = 'visual';
      {
        const isSay = s.data.type === TYPES.say;
        const q = isSay
          ? '<b>③ Шаг 3 из 4</b>\nКакой настрой? Нежно, романтично, со звёздами, по-дружески — или жми «На твой вкус».'
          : '<b>③ Шаг 3 из 4</b>\nКакой стиль хочешь? Строго, ярко, тёмный, минимал — любые мысли.';
        await ctx.reply(q, {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard().text(isSay ? 'На твой вкус' : 'Пропустить', 'visual:skip'),
        });
      }
      break;
    case 'visual':
      s.data.visual = text;
      goToPhotos(ctx);
      await askPhotos(ctx);
      break;
    default:
      await ctx.reply('Напиши /start, чтобы оставить заявку на сайт 🚀');
  }
});

// ── Узнаём id канала, когда бота делают админом ─────────────────
bot.on('my_chat_member', async (ctx) => {
  const chat = ctx.chat;
  if (chat.type === 'channel' || chat.type === 'supergroup') {
    console.log(`Бот добавлен в «${chat.title}» — CHANNEL_ID = ${chat.id}`);
    if (ADMIN_ID) {
      await bot.api
        .sendMessage(ADMIN_ID, `Канал «${chat.title}» подключён.\nCHANNEL_ID = <code>${chat.id}</code>`, {
          parse_mode: 'HTML',
        })
        .catch(() => {});
    }
  }
});

bot.catch((err) => console.error('Ошибка бота:', err.error || err));

// ── Запуск: webhook на хостинге (Render) / polling локально ──────
const { WEBHOOK_URL, WEBHOOK_SECRET = 'go3d-secret', PORT = 3000 } = process.env;

if (WEBHOOK_URL) {
  // Режим webhook — для постоянной работы на Render
  const handleUpdate = webhookCallback(bot, 'http', { secretToken: WEBHOOK_SECRET });
  const server = createServer(async (req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('go3d-bot ok');
      return;
    }
    if (req.method === 'POST' && req.url === '/webhook') {
      try {
        await handleUpdate(req, res);
      } catch (e) {
        console.error('Webhook error:', e);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      }
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(Number(PORT), async () => {
    await bot.init();
    await bot.api.setWebhook(`${WEBHOOK_URL}/webhook`, {
      secret_token: WEBHOOK_SECRET,
      drop_pending_updates: true,
    });
    console.log(`Бот @${bot.botInfo.username} на webhook: ${WEBHOOK_URL}/webhook (порт ${PORT})`);

    // Keep-alive: бесплатный план Render усыпляет сервис после ~15 мин без
    // трафика, из-за чего первый /start ждёт холодного старта. Пингуем сами
    // себя каждые 10 мин — входящий запрос держит сервис проснувшимся.
    setInterval(() => {
      fetch(WEBHOOK_URL).catch((e) => console.warn('keep-alive ping не прошёл:', e.message));
    }, 10 * 60 * 1000);
  });
} else {
  // Локальный режим — long polling
  bot.start({
    drop_pending_updates: true,
    onStart: (me) => console.log(`Бот @${me.username} запущен (polling). Жду /start…`),
  });
}
