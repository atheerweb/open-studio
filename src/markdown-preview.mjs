import {createElement} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const remarkPlugins = [remarkGfm];
const components = {
  a: ({node,href,...props}) => createElement('a', {
    ...props,href,
    ...(href && !href.startsWith('#') ? {target:'_blank',rel:'noreferrer'} : {})
  }),
  img: ({node,src,alt,...props}) => src
    ? createElement('img',{...props,src,alt,loading:'lazy',referrerPolicy:'no-referrer'})
    : createElement('span',null,alt)
};

function previewUrl(url,key) {
  // Relative paths must not resolve against Studio's own server.
  if (/^https?:\/\//i.test(url) || (key === 'href' && url.startsWith('#'))) return url;
}

export default function MarkdownPreview({source}) {
  return createElement('article',{className:'markdown-preview','aria-label':'Markdown preview',tabIndex:0},
    createElement(Markdown,{components,remarkPlugins,skipHtml:true,urlTransform:previewUrl},source));
}
