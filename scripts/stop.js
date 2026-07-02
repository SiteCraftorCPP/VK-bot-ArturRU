const fs = require('node:fs');
const path = require('node:path');

const lockPath = path.join(__dirname, '..', 'data', 'bot.lock');

if (!fs.existsSync(lockPath)) {
  console.log('Бот не запущен.');
  process.exit(0);
}

const pid = Number(fs.readFileSync(lockPath, 'utf8').trim());

try {
  process.kill(pid);
  console.log(`Бот остановлен (PID ${pid}).`);
} catch {
  console.log('Процесс бота не найден, lock-файл удалён.');
}

try {
  fs.unlinkSync(lockPath);
} catch {}
