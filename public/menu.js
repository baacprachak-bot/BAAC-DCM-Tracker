const select = document.querySelector('#menu-role');
const role = new URLSearchParams(location.search).get('role');
if ([...select.options].some(option => option.value === role)) select.value = role;
function updateLinks() {
  document.querySelectorAll('[data-page]').forEach(link => {
    link.href = `/sandbox?${new URLSearchParams({ page: link.dataset.page, role: select.value })}`;
  });
  document.querySelector('.back-link').href = `/sandbox?${new URLSearchParams({ role: select.value })}`;
}
select.addEventListener('change', updateLinks);
updateLinks();
