// Loopback-only mail servers for packaged-backend tests. They never forward mail.
import net from 'node:net';

export const MAIL_USERNAME = 'sender@example.invalid';
export const MAIL_PASSWORD = 'fixture-password';
export const ATTACHMENT_TEXT = 'Linux attachment roundtrip\n';
export const MESSAGE_SOURCE = [
  `From: Sender <${MAIL_USERNAME}>`,
  'To: recipient@example.invalid',
  'Subject: Linux native mail roundtrip',
  'Date: Sun, 22 Nov 2026 12:00:00 +0000',
  'Message-ID: <linux-fixture@example.invalid>',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="linux-fixture"',
  '', '--linux-fixture', 'Content-Type: text/plain; charset=utf-8', '',
  'Fetched through the packaged Rust backend.',
  '--linux-fixture', 'Content-Type: application/octet-stream; name="linux.txt"',
  'Content-Disposition: attachment; filename="linux.txt"',
  'Content-Transfer-Encoding: base64', '',
  Buffer.from(ATTACHMENT_TEXT).toString('base64'), '--linux-fixture--', '',
].join('\r\n');

function readLines(socket, onLine) {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.setTimeout(15000, () => socket.destroy());
  socket.on('error', () => {});
  socket.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\r\n')) {
      const end = buffer.indexOf('\r\n');
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      onLine(line);
    }
  });
}

export async function startMailServers() {
  const sockets = new Set();
  const deliveries = [];
  const track = handler => socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    handler(socket);
  };
  const imap = net.createServer(track(socket => {
    let authenticated = false;
    socket.write('* OK SuiteMail Linux fixture IMAP\r\n');
    readLines(socket, line => {
      const match = /^(\S+) (\S+)(?: (.*))?$/.exec(line);
      if (!match) return socket.destroy();
      const [, tag, verb, rest = ''] = match;
      const command = verb.toUpperCase();
      const ok = () => socket.write(`${tag} OK ${command} completed\r\n`);
      if (command === 'CAPABILITY') {
        socket.write('* CAPABILITY IMAP4rev1\r\n'); return ok();
      }
      if (command === 'LOGIN') {
        const args = [...rest.matchAll(/"((?:\\.|[^"\\])*)"|(\S+)/g)].map(item => item[1] ?? item[2]);
        authenticated = args[0] === MAIL_USERNAME && args[1] === MAIL_PASSWORD;
        return socket.write(`${tag} ${authenticated ? 'OK' : 'NO'} LOGIN ${authenticated ? 'completed' : 'rejected'}\r\n`);
      }
      if (command === 'LOGOUT') return socket.end(`* BYE Closing\r\n${tag} OK LOGOUT completed\r\n`);
      if (!authenticated) return socket.write(`${tag} NO Authenticate first\r\n`);
      if (command === 'LIST') socket.write('* LIST (\\HasNoChildren) "/" "INBOX"\r\n');
      else if (command === 'STATUS') socket.write('* STATUS "INBOX" (MESSAGES 1 UNSEEN 1 UIDNEXT 2 UIDVALIDITY 1)\r\n');
      else if (command === 'SELECT' || command === 'EXAMINE') socket.write('* FLAGS (\\Seen)\r\n* 1 EXISTS\r\n* 0 RECENT\r\n* OK [UIDVALIDITY 1] Valid\r\n* OK [UIDNEXT 2] Next\r\n');
      else if (command === 'UID' && /^SEARCH/i.test(rest)) socket.write('* SEARCH 1\r\n');
      else if (command === 'UID' && /^FETCH/i.test(rest)) {
        socket.write(`* 1 FETCH (UID 1 FLAGS () BODY[] {${Buffer.byteLength(MESSAGE_SOURCE)}}\r\n${MESSAGE_SOURCE})\r\n`);
      } else if (command !== 'NOOP') return socket.write(`${tag} BAD Unsupported fixture command\r\n`);
      ok();
    });
  }));
  const smtp = net.createServer(track(socket => {
    let authenticated = false;
    let authPending = false;
    let dataMode = false;
    let message = '';
    let envelope = [];
    socket.write('220 localhost SuiteMail Linux fixture SMTP\r\n');
    const authenticate = payload => {
      const parts = Buffer.from(payload, 'base64').toString().split('\0');
      authenticated = parts.at(-2) === MAIL_USERNAME && parts.at(-1) === MAIL_PASSWORD;
      socket.write(authenticated ? '235 Authenticated\r\n' : '535 Invalid credentials\r\n');
    };
    readLines(socket, line => {
      if (dataMode) {
        if (line === '.') {
          deliveries.push({ message, envelope });
          dataMode = false;
          socket.write('250 Accepted\r\n');
        } else message += `${line.startsWith('..') ? line.slice(1) : line}\r\n`;
        return;
      }
      if (authPending) { authPending = false; return authenticate(line); }
      if (/^EHLO\b/i.test(line)) socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');
      else if (/^AUTH PLAIN\b/i.test(line)) {
        const payload = line.split(' ')[2];
        if (payload) authenticate(payload);
        else { authPending = true; socket.write('334 \r\n'); }
      } else if (/^QUIT\b/i.test(line)) socket.end('221 Bye\r\n');
      else if (!authenticated) socket.write('530 Authenticate first\r\n');
      else if (/^MAIL FROM:/i.test(line)) { envelope = [line]; message = ''; socket.write('250 OK\r\n'); }
      else if (/^RCPT TO:/i.test(line)) { envelope.push(line); socket.write('250 OK\r\n'); }
      else if (/^DATA\b/i.test(line)) { dataMode = true; socket.write('354 End with dot\r\n'); }
      else if (/^(RSET|NOOP)\b/i.test(line)) socket.write('250 OK\r\n');
      else socket.write('500 Unsupported fixture command\r\n');
    });
  }));
  const listen = server => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  try {
    const imapPort = await listen(imap);
    const smtpPort = await listen(smtp);
    return {
      imapPort, smtpPort, deliveries,
      async close() {
        for (const socket of sockets) socket.destroy();
        await Promise.all([imap, smtp].map(server => new Promise(resolve => server.close(resolve))));
      },
    };
  } catch (error) {
    for (const socket of sockets) socket.destroy();
    imap.close(); smtp.close();
    throw error;
  }
}
