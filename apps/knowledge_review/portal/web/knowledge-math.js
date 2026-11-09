'use strict';
// Presentation only: preserve the immutable, hash-paired source assets.
const KnowledgeMath = (() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const atom = String.raw`(?:\([^()\n]+\)|(?:\d+(?:\.\d+)?|[a-zA-Z]+)(?:\^\d+)?)`;
  const fraction = new RegExp(`(${atom})\\s*/\\s*(${atom})`, 'g');
  function latex(text) {
    const ungroup = s => s.startsWith('(') && s.endsWith(')') ? s.slice(1,-1) : s;
    return text.replace(fraction, (_,a,b) => `\\frac{${latex(ungroup(a))}}{${latex(ungroup(b))}}`)
      .replace(/−/g,'-').replace(/×/g,'\\times ').replace(/÷/g,'\\div ')
      .replace(/≠/g,'\\ne ').replace(/≤/g,'\\le ').replace(/≥/g,'\\ge ');
  }
  function normalize(text) {
    return String(text ?? '').split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\])/g).map((part,i) => {
      if(i%2) return part;
      // Restrict inference to arithmetic containing a fraction; prose and URLs stay text.
      return part.replace(/(?:https?:\/\/\S+)|[a-zA-Z0-9(−-][a-zA-Z0-9\s.+*/=()^−×÷≠≤≥-]*\/[a-zA-Z0-9(−-][a-zA-Z0-9\s.+*/=()^−×÷≠≤≥-]*/g, s => {
        if(/^https?:/.test(s) || !s.match(fraction)) return s;
        const value=s.trim();
        return s.replace(value, '$'+latex(value)+'$');
      });
    }).join('');
  }
  function render(text) {
    return normalize(text).split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\])/g).map((s,i) => {
      if(!(i%2)) return escape(s);
      const block=s.startsWith('$$')||s.startsWith('\\['), size=s.startsWith('$')&&!block?1:2;
      try { return katex.renderToString(s.slice(size,-size), {throwOnError:false,trust:false,strict:false,displayMode:block}); }
      catch { return escape(s); }
    }).join('');
  }
  return {normalize,render};
})();
if(typeof module!=='undefined') module.exports=KnowledgeMath;
