const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT_DIR = path.join(__dirname, '..', 'screenshots');

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function login(email, password = 'Password123!') {
  const res = await fetch('http://localhost:5000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status}`);
  const setCookie = res.headers.get('set-cookie');
  let token = '';
  if (setCookie) {
    const m = setCookie.match(/aarogya_token=([^;]+)/);
    if (m) token = m[1];
  }
  const body = await res.json();
  return { user: body.user, token };
}

function sendCDP(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1000000);
    const handler = (raw) => {
      const data = JSON.parse(raw);
      if (data.id === id) {
        ws.off('message', handler);
        if (data.error) reject(new Error(JSON.stringify(data.error)));
        else resolve(data.result);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function run() {
  console.log('[Visual QA] Launching headless Chrome...');
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
  ]);

  await sleep(2000);

  // Get WebSocket debugger URL
  const versionRes = await fetch('http://localhost:9222/json/version');
  const versionData = await versionRes.json();
  const wsUrl = versionData.webSocketDebuggerUrl;
  console.log('[Visual QA] Connected to Chrome CDP:', wsUrl);

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve) => ws.on('open', resolve));

  // Create new target/tab
  const { targetId } = await sendCDP(ws, 'Target.createTarget', { url: 'about:blank' });
  const pageRes = await fetch('http://localhost:9222/json');
  const pages = await pageRes.json();
  const pageTarget = pages.find((p) => p.id === targetId);

  const pageWs = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve) => pageWs.on('open', resolve));

  await sendCDP(pageWs, 'Page.enable');
  await sendCDP(pageWs, 'Network.enable');

  const widths = [360, 768, 1280];
  const themes = ['light', 'dark'];

  // Test matrix
  const roles = [
    { name: 'public', email: null, routes: ['/login'] },
    { name: 'front_desk', email: 'frontdesk1@aarogya.local', routes: ['/appointments', '/book', '/patients', '/billing'] },
    { name: 'clinician', email: 'dr.bose@aarogya.local', routes: ['/queue', '/patients'] },
    { name: 'admin', email: 'admin@aarogya.local', routes: ['/dashboard', '/directory', '/audit'] },
  ];

  const layoutIssues = [];

  for (const role of roles) {
    console.log(`\n--- Testing role: ${role.name} ---`);
    if (role.email) {
      const { token } = await login(role.email);
      await sendCDP(pageWs, 'Network.setCookie', {
        name: 'aarogya_token',
        value: token,
        url: 'http://localhost:5173',
        path: '/',
        httpOnly: true,
      });
    } else {
      await sendCDP(pageWs, 'Network.clearBrowserCookies');
    }

    for (const route of role.routes) {
      for (const width of widths) {
        const height = width === 360 ? 740 : width === 768 ? 960 : 800;
        await sendCDP(pageWs, 'Emulation.setDeviceMetricsOverride', {
          width,
          height,
          deviceScaleFactor: 1,
          mobile: width <= 768,
        });

        const targetUrl = `http://localhost:5173${route}`;
        await sendCDP(pageWs, 'Page.navigate', { url: targetUrl });
        await sleep(1500);

        for (const theme of themes) {
          await sendCDP(pageWs, 'Runtime.evaluate', {
            expression: `
              if ('${theme}' === 'dark') {
                document.documentElement.classList.add('dark');
              } else {
                document.documentElement.classList.remove('dark');
              }
            `,
          });
          await sleep(300);

          // Check for horizontal overflow
          const checkOverflow = await sendCDP(pageWs, 'Runtime.evaluate', {
            expression: `
              ({
                scrollWidth: document.documentElement.scrollWidth,
                clientWidth: document.documentElement.clientWidth,
                innerWidth: window.innerWidth,
                hasOverflow: document.documentElement.scrollWidth > window.innerWidth,
                bodyScrollWidth: document.body.scrollWidth
              })
            `,
            returnByValue: true,
          });

          const result = checkOverflow.result.value;
          if (result.hasOverflow || result.bodyScrollWidth > width) {
            const diff = Math.max(result.scrollWidth, result.bodyScrollWidth) - width;
            if (diff > 1) {
              const issue = `[OVERFLOW] ${role.name} ${route} @ ${width}px (${theme}): scrollWidth ${Math.max(result.scrollWidth, result.bodyScrollWidth)} > ${width} (diff: +${diff}px)`;
              console.warn(issue);
              layoutIssues.push(issue);
            }
          }

          // Take screenshot
          const safeRoute = route.replace(/\//g, '_').replace(/^_/, '');
          const filename = `${role.name}-${safeRoute}-${width}px-${theme}.png`;
          const filepath = path.join(OUT_DIR, filename);

          const { data } = await sendCDP(pageWs, 'Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(filepath, Buffer.from(data, 'base64'));
          console.log(`Saved screenshot: ${filename}`);
        }
      }
    }
  }

  // Also test clinician patient record
  console.log(`\n--- Testing Clinician Patient Record ---`);
  const { token: docToken } = await login('dr.bose@aarogya.local');
  await sendCDP(pageWs, 'Network.setCookie', {
    name: 'aarogya_token',
    value: docToken,
    url: 'http://localhost:5173',
    path: '/',
    httpOnly: true,
  });

  // Get a patient id from /api/v1/patients
  const patRes = await fetch('http://localhost:5000/api/v1/patients?pageSize=1', {
    headers: { Cookie: `aarogya_token=${docToken}` },
  });
  const patData = await patRes.json();
  const samplePatientId = patData.data?.[0]?.id;

  if (samplePatientId) {
    for (const width of widths) {
      const height = width === 360 ? 740 : width === 768 ? 960 : 800;
      await sendCDP(pageWs, 'Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width <= 768,
      });

      const targetUrl = `http://localhost:5173/patients/${samplePatientId}/record`;
      await sendCDP(pageWs, 'Page.navigate', { url: targetUrl });
      await sleep(1500);

      for (const theme of themes) {
        await sendCDP(pageWs, 'Runtime.evaluate', {
          expression: `
            if ('${theme}' === 'dark') {
              document.documentElement.classList.add('dark');
            } else {
              document.documentElement.classList.remove('dark');
            }
          `,
        });
        await sleep(300);

        const checkOverflow = await sendCDP(pageWs, 'Runtime.evaluate', {
          expression: `
            ({
              scrollWidth: document.documentElement.scrollWidth,
              innerWidth: window.innerWidth,
              hasOverflow: document.documentElement.scrollWidth > window.innerWidth,
              bodyScrollWidth: document.body.scrollWidth
            })
          `,
          returnByValue: true,
        });

        const result = checkOverflow.result.value;
        if (result.hasOverflow || result.bodyScrollWidth > width) {
          const diff = Math.max(result.scrollWidth, result.bodyScrollWidth) - width;
          if (diff > 1) {
            const issue = `[OVERFLOW] clinician /patients/:id/record @ ${width}px (${theme}): scrollWidth ${Math.max(result.scrollWidth, result.bodyScrollWidth)} > ${width} (diff: +${diff}px)`;
            console.warn(issue);
            layoutIssues.push(issue);
          }
        }

        const filename = `clinician-patient_record-${width}px-${theme}.png`;
        const filepath = path.join(OUT_DIR, filename);
        const { data } = await sendCDP(pageWs, 'Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(filepath, Buffer.from(data, 'base64'));
        console.log(`Saved screenshot: ${filename}`);
      }
    }
  }

  pageWs.close();
  ws.close();
  chrome.kill();

  console.log('\n======================================');
  console.log(`Visual QA Complete. Captured ${fs.readdirSync(OUT_DIR).length} screenshots.`);
  if (layoutIssues.length === 0) {
    console.log('Zero overflow issues detected across all widths and themes!');
  } else {
    console.log('Layout/Overflow Issues Found:');
    layoutIssues.forEach((iss) => console.log(' - ' + iss));
  }
  console.log('======================================');
}

run().catch((err) => {
  console.error('[Visual QA Error]:', err);
  process.exit(1);
});
