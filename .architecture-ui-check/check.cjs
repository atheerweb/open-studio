const {app,BrowserWindow} = require('electron');
const assert = require('node:assert/strict');
app.whenReady().then(async ()=>{
  const win = new BrowserWindow({show:false,width:1160,height:850});
  const page = win.webContents;
  await win.loadURL('http://127.0.0.1:47631/.architecture-ui-check/index.html');
  async function evaluate(fn) { return page.executeJavaScript('(' + fn.toString() + ')()'); }
  for (let attempt = 0; attempt < 50 && !(await evaluate(()=>document.querySelector('.arch-tabs') !== null)); attempt++) {
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  const errors = [];
  try {
    await evaluate(()=>[...document.querySelectorAll('.arch-tabs button')].find(button=>button.textContent.includes('Business Lifecycles')).click());
    const initial = await evaluate(()=>document.querySelector('[aria-label="Alternate paths"]').innerText);
    for (const text of ['From Under Review','Returned for Amendment','Rejected','From Returned for Amendment','resubmit']) {
      assert.ok(initial.includes(text), 'Alternate paths initially show ' + text);
    }
    await evaluate(()=>document.querySelector('.arch-flow-card .arch-control').click());
    assert.equal(await evaluate(()=>document.querySelector('[aria-label="Alternate paths"]').innerText),initial);
    await evaluate(()=>[...document.querySelectorAll('[aria-label="Alternate paths"] button')].find(button=>button.textContent.includes('Returned for Amendment')).click());
    assert.match(await evaluate(()=>document.querySelector('.arch-evidence').innerText), /Under Review → Returned for Amendment/);
  } catch (error) { errors.push(error); }
  try {
    await evaluate(()=>document.querySelector('.arch-tabs button').click());
    const map = await evaluate(()=>document.querySelector('[aria-label="Module relationships map"]').innerText);
    assert.match(map, /Used by[\s\S]*DocumentWorkflowAdministration/);
    assert.match(map, /Uses[\s\S]*Notification Delivery/);
    assert.ok(!map.includes('Unrelated module'));
    await evaluate(()=>[...document.querySelectorAll('[aria-label="Module relationships map"] button')].find(button=>button.textContent.includes('Notification Delivery')).click());
    assert.match(await evaluate(()=>document.querySelector('[aria-label="Module relationships map"]').innerText), /Uses[\s\S]*Unrelated module/);
    await evaluate(()=>document.querySelector('[aria-label="Module relationships map"] button[aria-label^="View source evidence"]').click());
    assert.match(await evaluate(()=>document.querySelector('.arch-evidence').innerText), /Lawsuit → Notification Delivery/);
    win.setContentSize(400,850);
    await new Promise(resolve=>setTimeout(resolve,150));
    assert.ok(await evaluate(()=>{
      const map = document.querySelector('[aria-label="Module relationships map"]');
      return map.offsetWidth > 0 && document.documentElement.scrollWidth <= innerWidth;
    }), 'Map stays visible without horizontal overflow on narrow screens');
  } catch (error) { errors.push(error); }
  for (const error of errors) console.error(error.message);
  if (!errors.length) console.log('Browser checks passed for dependency navigation, source evidence, alternate paths and narrow layout.');
  app.exit(errors.length ? 1 : 0);
}).catch(error=>{ console.error(error); app.exit(1); });
