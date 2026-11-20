// The home page's topic choice arrives in the address (`/contact?topic=studio`): select it in the form.
(() => {
  const topic = new URLSearchParams(location.search).get('topic');
  const input = topic && document.querySelector(`form.cform input[name="topic"][value="${CSS.escape(topic)}"]`);
  if (input) input.checked = true;
})();
