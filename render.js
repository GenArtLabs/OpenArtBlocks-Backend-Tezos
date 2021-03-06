const webdriver = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const { Mutex } = require("async-mutex");
const { readFileSync, promises } = require('fs');
const { writeFile, readFile, access } = promises;
const Jimp = require('jimp');

const redis = require('./redis');
const { inject } = require('./templating');
const HTML_p5 = readFileSync('templates/p5_render.html').toString();
const HTML_svg = readFileSync('templates/svg_render.html').toString();

const HTMLs = [HTML_p5, HTML_svg];

const buildDriver = () => {
  let options = new chrome.Options();

  options.setChromeBinaryPath(process.env.CHROME_BINARY_PATH);
  let serviceBuilder = new chrome.ServiceBuilder(process.env.CHROME_DRIVER_PATH);

  options.windowSize({ width: 1024, height: 1024 });

  //Don't forget to add these for heroku
  options.headless();
  options.addArguments("--disable-gpu");
  options.addArguments("--no-sandbox");

  let driver = new webdriver.Builder()
    .forBrowser('chrome')
    .setChromeOptions(options)
    .setChromeService(serviceBuilder)
    .build();

  return driver;
}

const metadataCache = {};

const driver = buildDriver();
const mutex = new Mutex();

const getData = async (URI) => {
  const release = await mutex.acquire();
  try {
    await driver.get(URI);

    const res = await driver.executeAsyncScript("wait(arguments[0]);");//arguments[arguments.length - 1]
    if (res[1] === null) {
      const svg = driver.findElement(webdriver.By.id('render'));
      res[1] = await svg.takeScreenshot();
    }
    return res;
  } finally {
    release();
  }
}

const render = async ({ script, type }, tokenInfo, count) => {
  const htmlContent = inject(HTMLs[type], {
    script,
    info: JSON.stringify(tokenInfo),
    count,
  });
  // await writeFile('/tmp/test.html', htmlContent);

  let [metadata, b64Img, b64Thumb] = await getData("data:text/html;base64," + Buffer.from(htmlContent, 'utf-8').toString('base64'));

  const path = `generated/${tokenInfo.tokenHash}.png`;
  const thumbnailPath = `generated/thumb_${tokenInfo.tokenHash}.png`;
  metadataCache[tokenInfo.tokenHash] = metadata;

  if (b64Thumb === null) {
    const img = await Jimp.read(Buffer.from(b64Img, 'base64'));
    img.resize(350, 350).write(thumbnailPath);
  } else {
    await writeFile(thumbnailPath, b64Thumb, { encoding: 'base64' });
  }

  await writeFile(path, b64Img, { encoding: 'base64' });
  redis.setMetadata(0, tokenInfo.tokenId, metadata);

  return { metadata };
}

const getStaticImagePath = async (script, tokenInfo, count) => {
  const path = `generated/${tokenInfo.tokenHash}.png`;
  try {
    await access(path);
  } catch {
    await render(script, tokenInfo, count);
  }
  return path;
}

const getThumbnailPath = async (script, tokenInfo, count) => {
  const path = `generated/thumb_${tokenInfo.tokenHash}.png`;
  try {
    await access(path);
  } catch {
    await render(script, tokenInfo, count);
  }
  return path;
}

const getMetadata = async (script, tokenInfo, count) => {
  const { tokenHash, tokenId } = tokenInfo;
  if (metadataCache[tokenHash]) return metadataCache[tokenHash];

  let data;
  {
    const meta = await redis.getMetadata(0, tokenId);
    if (meta) {
      data = meta;
      metadataCache[tokenHash] = meta;
    }
    else {
      const { metadata } = await render(script, tokenInfo, count);
      data = metadata;
    }
  }
  return data;
}

module.exports = { getStaticImagePath, getThumbnailPath, getMetadata };
