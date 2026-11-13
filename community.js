// Community features integration for the portfolio
// Provides follow, comment, and contact functionality

(function () {
  'use strict';

  // Initialize community features when DOM is ready
  function init() {
    addFollowButton();
    addCommentSystem();
    addContactForm();
  }

  function addFollowButton() {
    const followButtons = document.querySelectorAll('[data-community-follow]');
    followButtons.forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          const response = await window.portfolioApiFetch('/api/community/follow', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ following: button.dataset.following !== 'true' }),
          });
          if (response.ok) {
            const data = await response.json();
            button.dataset.following = data.following ? 'true' : 'false';
            button.textContent = data.following ? 'Following' : 'Follow';
          }
        } catch (error) {
          console.error('Follow action failed:', error);
        }
      });
    });
  }

  function addCommentSystem() {
    const commentForms = document.querySelectorAll('[data-community-comment-form]');
    commentForms.forEach((form) => {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const pageKey = form.dataset.pageKey;
        const message = form.querySelector('textarea[name="message"]')?.value;
        if (!message || message.length < 2) return;

        try {
          const response = await window.portfolioApiFetch('/api/community/comment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pageKey, message }),
          });
          if (response.ok) {
            form.reset();
            showFeatureToast('Comment submitted for moderation.', 'success');
          }
        } catch (error) {
          console.error('Comment submission failed:', error);
        }
      });
    });
  }

  function addContactForm() {
    const contactForms = document.querySelectorAll('[data-community-contact-form]');
    contactForms.forEach((form) => {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const payload = {
          name: formData.get('name'),
          email: formData.get('email'),
          message: formData.get('message'),
        };

        try {
          const response = await window.portfolioApiFetch('/api/community/contact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (response.ok) {
            form.reset();
            showFeatureToast('Message sent to the owner inbox.', 'success');
          }
        } catch (error) {
          console.error('Contact submission failed:', error);
        }
      });
    });
  }

  function showFeatureToast(message, type = 'info') {
    if (typeof window.showFeatureToast === 'function') {
      window.showFeatureToast(message, type);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();