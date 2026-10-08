// A few lines run by the browser the moment the nav is parsed, before the first paint and before /nav.js has been fetched: they turn the
// dial to this page's stop (Home when the page has no tab of its own), give every stop its size and put the needle under this page's stop, so on a slow connection the middle stop
// is already exactly in the middle and the sizes already step down, instead of the dial sitting at its first stop and jumping when the
// script arrives. /nav.js does the same again once it runs, and everything after that. Pure text, so the worker and a node test share it.

export const DIAL_PRESET_SCRIPT =
  '(function(){var t=document.querySelector(".tabs");if(!t||!t.clientWidth)return;' +
  'var s=[].slice.call(t.querySelectorAll(":scope > .tab,:scope > .tab-group"));if(!s.length)return;' +
  'var a=s.map(function(x){return x.classList.contains("tab-group")?x.querySelector(".tab")||x:x}),' +
  'g=a.indexOf(t.querySelector(".tab.is-active")||t.querySelector(".tab-home"));if(g<0)g=Math.floor((a.length-1)/2);' +
  'var o=t.getBoundingClientRect().left+t.clientLeft-t.scrollLeft,' +
  'c=a.map(function(x){var r=x.getBoundingClientRect();return r.left+r.width/2-o}),' +
  "p=c.length>1?Math.abs(c[1]-c[0]):72;t.scrollLeft=c[g]-t.clientWidth/2;var m=t.scrollLeft+t.clientWidth/2;" +
  's.forEach(function(x,i){x.style.setProperty("--d",Math.min(Math.abs(c[i]-m)/p,3).toFixed(3))});' +
  'var n=t.closest(".site-nav"),k=t.querySelector(".tab.is-active");if(n&&k){var r=k.getBoundingClientRect();' +
  'n.style.setProperty("--needle-x",(r.left+r.width/2-n.getBoundingClientRect().left).toFixed(1)+"px")}})();';
