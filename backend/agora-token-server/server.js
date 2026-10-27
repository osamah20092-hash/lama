require('dotenv').config();
const express = require('express');
const { RtcTokenBuilder, RtcRole } = require('agora-token');

const APP_ID = process.env.AGORA_APP_ID;
const APP_CERT = process.env.AGORA_APP_CERTIFICATE;
const PORT = process.env.PORT || 8080;
const TTL_SECONDS = Number(process.env.TOKEN_TTL || 3600);

if (!APP_ID || !APP_CERT) {
  console.error('Set AGORA_APP_ID and AGORA_APP_CERTIFICATE in .env');
  process.exit(1);
}

const app = express();

// GET /rtc/:channel/:uid  ->  { token, expiresIn }
app.get('/rtc/:channel/:uid', (req, res) => {
  const { channel } = req.params;
  const uid = Number(req.params.uid) || 0;
  if (!channel || channel.length > 64) {
    return res.status(400).json({ error: 'invalid channel' });
  }
  const now = Math.floor(Date.now() / 1000);
  const privilegeExpire = now + TTL_SECONDS;
  try {
    const token = RtcTokenBuilder.buildTokenWithUid(
      APP_ID, APP_CERT, channel, uid,
      RtcRole.PUBLISHER, privilegeExpire, privilegeExpire
    );
    res.json({ token, expiresIn: TTL_SECONDS });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'token generation failed' });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Agora token server on :${PORT}`));
