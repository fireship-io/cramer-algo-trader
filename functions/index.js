const functions = require('firebase-functions');

//// SDK Config ////

const { Configuration, OpenAIApi } = require('openai');
const configuration = new Configuration({
  organization: functions.config().openai.id, // REPLACE with your API credentials
  apiKey: functions.config().openai.key, // REPLACE with your API credentials
});
const openai = new OpenAIApi(configuration);

const Alpaca = require('@alpacahq/alpaca-trade-api');
const alpaca = new Alpaca({
  keyId: functions.config().alpaca.id, // REPLACE with your API credentials
  secretKey: functions.config().alpaca.key, // REPLACE with your API credentials
  // paper: true,
});

//// PUPPETEER Scrape Data from Twitter for better AI context ////

const puppeteer = require('puppeteer');

/*async function scrape() {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  await page.goto('https://twitter.com/jimcramer', {
    waitUntil: 'networkidle2',
  });

  await page.waitForTimeout(3000);

  // await page.screenshot({ path: 'example.png' });

  const tweets = await page.evaluate(async () => {
    return document.body.innerText;
  });

  await browser.close();

  return tweets;
}
*/

async function autoScroll(page){
  await page.evaluate(async () => {
      await new Promise((resolve, reject) => {
          var totalHeight = 0;
          var distance = 100;
          var timer = setInterval(() => {
              var scrollHeight = 10000; //document.body.scrollHeight;
              window.scrollBy(0, distance);
              totalHeight += distance;

              if(totalHeight >= scrollHeight - window.innerHeight){
                  clearInterval(timer);
                  resolve();
              }
          }, 100);
      });
  });
}
async function scrape() {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  await page.goto('https://twitter.com/jimcramer', {
    waitUntil: 'networkidle2',
  });

  await page.setViewport({
    width: 1200,
    height: 800
});

  await page.waitForTimeout(3000);

  // await page.screenshot({ path: './puppeteerArtifacts/example.png' });


  let divs = await page.$$('div[data-testid="cellInnerDiv"]')

  console.log(divs.length)

  await autoScroll(page)

  let newDivs = await page.$$('div[data-testid="cellInnerDiv"]')

  newDivs.forEach( (div)  => divs.push(div))

  console.log(divs.length)

  const tweets = new Array();

  for (const div of divs) {
    const innerText = await div.evaluate((x) => x.innerText)
    if (!innerText.includes("Pinned Tweet")) {
      const innerTextArray = innerText.split("\n")
      const tweetText = innerTextArray.slice(4, -2).join(" ")
  
      console.log("\nTweet")
      console.log(tweetText)
      tweets.push(tweetText)
    }
  }

  await browser.close();

  return tweets;
};
exports.helloWorld = functions.https.onRequest(async (request, response) => {
  // test logic here

  response.send('test');
});

exports.getRichQuick = functions
  .runWith({ memory: '4GB' })
  .pubsub.schedule('0 10 * * 1-5')
  .timeZone('America/New_York')
  .onRun(async (ctx) => {
    console.log('This will run M-F at 10:00 AM Eastern!');

    const tweets = await scrape();

    const gptCompletion = await openai.createCompletion('text-davinci-003', {
      prompt: `${tweets} Jim Cramer recommends selling the following stock tickers: `,
      temperature: 0.7,
      max_tokens: 32,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    });

    const stocksToBuy = gptCompletion.data.choices[0].text.match(/\b[A-Z]+\b/g);
    console.log(`Thanks for the tips Jim! ${stocksToBuy}`);

    if (!stocksToBuy) {
      console.log('sitting this one out');
      return null;
    }

    //// ALPACA Make Trades ////

    // close all positions
    const cancel = await alpaca.cancelAllOrders();
    const liquidate = await alpaca.closeAllPositions();

    // get account
    const account = await alpaca.getAccount();
    console.log(`dry powder: ${account.buying_power}`);

    // place order
    const order = await alpaca.createOrder({
      symbol: stocksToBuy[0],
      // qty: 1,
      notional: account.buying_power * 0.9, // will buy fractional shares
      side: 'buy',
      type: 'market',
      time_in_force: 'day',
    });

    console.log(`look mom i bought stonks: ${order.id}`);

    return null;
  });
