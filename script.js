const yearElement = document.querySelector('#year');
const themeButton = document.querySelector('#themeToggle');
const menuButton = document.querySelector('#menuToggle');
const navigation = document.querySelector('#navLinks');
const navigationLinks = [...document.querySelectorAll('#navLinks a[data-page]')];

const readSavedTheme = () => {
	try {
		return localStorage.getItem('portfolio-theme');
	} catch {
		return null;
	}
};

const applyTheme = (theme, savePreference = false) => {
	const selectedTheme = theme === 'dark' ? 'dark' : 'light';
	const isDark = selectedTheme === 'dark';
	document.documentElement.dataset.theme = selectedTheme;

	if (themeButton) {
		const label = `Switch to ${isDark ? 'light' : 'dark'} theme`;
		themeButton.setAttribute('aria-label', label);
		themeButton.setAttribute('title', label);
		themeButton.setAttribute('aria-pressed', String(isDark));
	}

	if (savePreference) {
		try {
			localStorage.setItem('portfolio-theme', selectedTheme);
		} catch {
			return;
		}
	}
};

applyTheme(readSavedTheme() || document.documentElement.dataset.defaultTheme);

if (themeButton) {
	themeButton.addEventListener('click', () => {
		const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
		applyTheme(nextTheme, true);
	});
}

if (window.lucide?.createIcons) {
	window.lucide.createIcons();
}

if (yearElement) {
	yearElement.textContent = new Date().getFullYear();
}

const allowedHref = (value) => typeof value === 'string' && /^(https:\/\/|mailto:|tel:|#)/i.test(value);
const setTextIfPresent = (selector, value) => {
	const element = document.querySelector(selector);
	if (element) element.textContent = value;
};

const renderPortfolio = (data) => {
	if (!data || typeof data !== 'object') return;
	window.portfolioData = data;

	document.querySelectorAll('[data-portfolio-name]').forEach((element) => {
		element.textContent = data.name;
	});
	setTextIfPresent('#portfolioTagline', data.tagline);
	setTextIfPresent('#portfolioIntro', data.intro);
	setTextIfPresent('#portfolioAboutHeading', data.aboutHeading);
	setTextIfPresent('#pageAboutHeading', data.aboutHeading);

	const nameHeading = document.querySelector('#portfolioName');
	if (nameHeading) {
		const nameParts = data.name.trim().split(/\s+/);
		const lastName = nameParts.pop() || '';
		const lastNameElement = document.createElement('span');
		lastNameElement.textContent = lastName;
		nameHeading.replaceChildren(document.createTextNode(`${nameParts.join(' ')} `), lastNameElement);
	}

	const aboutParagraphs = document.querySelector('#portfolioAboutParagraphs');
	if (aboutParagraphs) aboutParagraphs.replaceChildren(...data.aboutParagraphs.map((text) => {
		const paragraph = document.createElement('p');
		paragraph.textContent = text;
		return paragraph;
	}));
	const pageAboutParagraphs = document.querySelector('#pageAboutParagraphs');
	if (pageAboutParagraphs) pageAboutParagraphs.replaceChildren(...data.aboutParagraphs.map((text) => {
		const paragraph = document.createElement('p');
		paragraph.textContent = text;
		return paragraph;
	}));

	const skills = document.querySelector('#portfolioSkills');
	const pageSkills = document.querySelector('#pageSkills');
	const renderSkills = (target) => target?.replaceChildren(...data.skills.map((text) => {
		const skill = document.createElement('button');
		skill.type = 'button';
		skill.className = 'skill-interest';
		skill.dataset.interest = text;
		skill.textContent = text;
		return skill;
	}));
	renderSkills(skills);
	renderSkills(pageSkills);

	const focus = document.querySelector('#portfolioFocus');
	if (focus) focus.replaceChildren(...data.focus.map((item, index) => {
		const article = document.createElement('article');
		article.className = 'focus-item';
		const number = document.createElement('span');
		number.className = 'focus-number';
		number.textContent = String(index + 1).padStart(2, '0');
		const icon = document.createElement('i');
		icon.dataset.lucide = /^[a-z0-9-]{1,40}$/i.test(item.icon) ? item.icon : 'sparkles';
		icon.setAttribute('aria-hidden', 'true');
		const title = document.createElement('h3');
		title.textContent = item.title;
		const description = document.createElement('p');
		description.textContent = item.description;
		article.append(number, icon, title, description);
		return article;
	}));
	const pageFocus = document.querySelector('#pageFocus');
	if (pageFocus) pageFocus.replaceChildren(...data.focus.map((item, index) => {
		const article = document.createElement('article');
		article.className = 'focus-item';
		const number = document.createElement('span');
		number.className = 'focus-number';
		number.textContent = String(index + 1).padStart(2, '0');
		const icon = document.createElement('i');
		icon.dataset.lucide = /^[a-z0-9-]{1,40}$/i.test(item.icon) ? item.icon : 'sparkles';
		icon.setAttribute('aria-hidden', 'true');
		const title = document.createElement('h3');
		title.textContent = item.title;
		const description = document.createElement('p');
		description.textContent = item.description;
		article.append(number, icon, title, description);
		return article;
	}));

	const education = document.querySelector('#portfolioEducation');
	const pageEducation = document.querySelector('#pageEducation');
	const renderEducation = (target) => target?.replaceChildren(...data.education.map((item) => {
		const article = document.createElement('article');
		article.className = 'education-item';
		const period = document.createElement('span');
		period.className = 'education-years';
		period.textContent = item.period;
		const details = document.createElement('div');
		const title = document.createElement('h3');
		title.textContent = item.title;
		const description = document.createElement('p');
		description.textContent = item.description;
		details.append(title, description);
		article.append(period, details);
		return article;
	}));
	renderEducation(education);
	renderEducation(pageEducation);

	const projects = document.querySelector('#portfolioProjects');
	const pageProjects = document.querySelector('#pageProjects');
	const renderProjects = (target) => target?.replaceChildren(...data.projects.map((item) => {
		const article = document.createElement('article');
		article.className = 'project-card';
		const image = document.createElement('div');
		image.className = 'project-image';
		image.textContent = item.number;
		const body = document.createElement('div');
		body.className = 'project-body';
		const meta = document.createElement('div');
		meta.className = 'project-meta';
		const title = document.createElement('h3');
		title.textContent = item.title;
		const category = document.createElement('span');
		category.textContent = item.category;
		meta.append(title, category);
		const description = document.createElement('p');
		description.textContent = item.description;
		const link = document.createElement('a');
		link.className = 'project-link';
		link.href = allowedHref(item.url) ? item.url : '#contact';
		link.append(document.createTextNode('View details '));
		const icon = document.createElement('i');
		icon.dataset.lucide = 'arrow-up-right';
		icon.setAttribute('aria-hidden', 'true');
		link.append(icon);
		body.append(meta, description, link);
		article.append(image, body);
		return article;
	}));
	renderProjects(projects);
	renderProjects(pageProjects);

	const contacts = document.querySelector('#portfolioContacts');
	const pageContacts = document.querySelector('#pageContacts');
	const renderContacts = (target) => target?.replaceChildren(...data.contacts.map((item) => {
		const link = document.createElement('a');
		link.href = allowedHref(item.href) ? item.href : '#contact';
		if (item.external) {
			link.target = '_blank';
			link.rel = 'noopener noreferrer';
		}
		const icon = document.createElement('i');
		icon.dataset.lucide = /^[a-z0-9-]{1,40}$/i.test(item.icon) ? item.icon : 'link';
		icon.setAttribute('aria-hidden', 'true');
		link.append(icon, document.createTextNode(item.label));
		return link;
	}));
	renderContacts(contacts);
	renderContacts(pageContacts);

	if (window.lucide?.createIcons) window.lucide.createIcons();
};

window.portfolioApiFetch('/api/portfolio', { cache: 'no-store' })
	.then((response) => (response.ok ? response.json() : null))
	.then(renderPortfolio)
	.catch(() => {});

const setMenuOpen = (isOpen) => {
	if (!menuButton || !navigation) return;

	navigation.classList.toggle('open', isOpen);
	menuButton.setAttribute('aria-expanded', String(isOpen));
	menuButton.setAttribute(
		'aria-label',
		isOpen ? 'Close navigation menu' : 'Open navigation menu'
	);
};

if (menuButton && navigation) {
	menuButton.addEventListener('click', () => {
		const isOpen = menuButton.getAttribute('aria-expanded') !== 'true';
		setMenuOpen(isOpen);
	});

	document.addEventListener('click', (event) => {
		if (!navigation.contains(event.target) && !menuButton.contains(event.target)) {
			setMenuOpen(false);
		}
	});

	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
			setMenuOpen(false);
			menuButton.focus();
		}
	});
}

const currentPage = window.location.pathname.split('/').pop() || 'index.html';
navigationLinks.forEach((link) => {
	const isCurrentPage = link.dataset.page === currentPage;
	link.classList.toggle('active', isCurrentPage);
	if (isCurrentPage) link.setAttribute('aria-current', 'page');
	else link.removeAttribute('aria-current');

	link.addEventListener('click', () => setMenuOpen(false));
});
