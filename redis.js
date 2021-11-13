const { createClient } = require('redis');

const client = (async () => {
  const client = createClient({ url: process.env.REDISCLOUD_URL, no_ready_check: true });
  client.on('error', (err) => console.error('Redis Client Error', err));
  await client.connect();
  return client;
})();

const getMetadata = async (tokenHash) => {
  const key = `metadata_${tokenHash}`;
  return JSON.parse(await (await client).get(key));
};

const setMetadata = async (tokenHash, metadata) => {
  const key = `metadata_${tokenHash}`;
  await (await client).set(key, JSON.stringify(metadata));
};

module.exports = { getMetadata, setMetadata };