const pageLinks = [
  { file: 'index.html', label: 'Home', icon: 'house' },
  { file: 'about.html', label: 'About', icon: 'user-round' },
  { file: 'skills.html', label: 'Skills', icon: 'code-xml' },
  { file: 'education.html', label: 'Education', icon: 'graduation-cap' },
  { file: 'projects.html', label: 'Projects', icon: 'folders' },
  { file: 'athletics.html', label: 'Athletics', icon: 'activity' },
  { file: 'coding.html', label: 'Coding', icon: 'terminal' },
  { file: 'academic-record.html', label: 'Academic Record', icon: 'scroll-text' },
  { file: 'professional-focus.html', label: 'Professional Focus', icon: 'compass' },
  { file: 'contact.html', label: 'Contact', icon: 'mail' },
];

const pageDefinitions = {
  about: {
    eyebrow: 'Profile',
    title: 'About me',
    lede: 'Software engineer, Computer Science student, coder, and athletics enthusiast.',
    blocks: [
      { heading: 'A little about my journey', type: 'about' },
      { heading: 'Interests and strengths', type: 'focus' },
    ],
  },
  skills: {
    eyebrow: 'Tools and strengths',
    title: 'Skills',
    lede: 'The technologies and working strengths I am building as a Computer Science student and software engineer.',
    blocks: [
      { heading: 'Current skills', type: 'skills' },
      { heading: 'How I approach learning', type: 'focus' },
    ],
  },
  education: {
    eyebrow: 'Academic background',
    title: 'Education',
    lede: 'My path from primary and secondary school to studying Computer Science at the University of Embu.',
    blocks: [
      { heading: 'Education history', type: 'education' },
      { heading: 'Current degree', type: 'degree' },
      { heading: 'Computer Science learning', type: 'study-gallery' },
    ],
  },
  projects: {
    eyebrow: 'Selected work',
    title: 'Projects',
    lede: 'A selection of web and coding work from my portfolio.',
    blocks: [
      { heading: 'Project work', type: 'projects' },
      { heading: 'Areas of interest', type: 'focus' },
    ],
  },
  athletics: {
    eyebrow: 'Beyond the screen',
    title: 'Athletics',
    lede: 'Athletics is one of my hobbies and an important part of how I balance study, coding, and personal growth.',
    blocks: [
      { heading: 'What athletics brings to my life', type: 'athletics' },
      { heading: 'The mindset I carry forward', type: 'athletic-focus' },
    ],
  },
  coding: {
    eyebrow: 'Curiosity in practice',
    title: 'Coding',
    lede: 'Coding is both my profession and one of my favorite ways to explore ideas and solve problems.',
    blocks: [
      { heading: 'My current toolkit', type: 'skills' },
      { heading: 'What I enjoy building', type: 'coding' },
    ],
  },
  'academic-record': {
    eyebrow: 'Learning milestones',
    title: 'Academic record',
    lede: 'The education milestones and results I have shared so far.',
    blocks: [
      { heading: 'Schools and results', type: 'education' },
      { heading: 'My degree path', type: 'degree' },
      { heading: 'Learning and collaboration', type: 'study-gallery' },
    ],
  },
  'professional-focus': {
    eyebrow: 'Where I am headed',
    title: 'Professional focus',
    lede: 'Growing as a software engineer while pursuing a Computer Science degree.',
    blocks: [
      { heading: 'My areas of focus', type: 'focus' },
      { heading: 'Skills I am developing', type: 'skills' },
    ],
  },
  contact: {
    eyebrow: 'Get in touch',
    title: 'Contact',
    lede: 'Reach out about software, projects, collaboration, or professional opportunities.',
    blocks: [
      { heading: 'Contact links', type: 'contacts' },
      { heading: 'A little context', type: 'contact-note' },
    ],
  },
};

const pageKey = document.body.dataset.sitePage;
const pageDefinition = pageDefinitions[pageKey];
const pageRoot = document.querySelector('#pageRoot');

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function renderStaticSkills() {
  const list = createElement('div', 'skill-list', '');
  list.id = 'pageSkills';
  list.setAttribute('aria-label', 'Skills');
  ['HTML', 'CSS', 'JavaScript', 'Responsive Design', 'UI/UX Basics', 'Git & GitHub', 'Web Development'].forEach((skill) => {
    const button = createElement('button', 'skill-interest', skill);
    button.type = 'button';
    button.dataset.interest = skill;
    list.append(button);
  });
  return list;
}

function renderStaticEducation() {
  const list = createElement('div', 'education-list', '');
  list.id = 'pageEducation';
  [
    ['2024–2028', 'BSc in Computer Science', 'University of Embu (UoEm) · Currently pursuing'],
    ['Completed 2023', 'Secondary Education', 'Mwihangia Mixed Day Secondary School · Grade B+'],
    ['Completed 2017', 'Primary Education', 'Mwihangia Primary School · 299 marks'],
  ].forEach(([period, titleText, descriptionText]) => {
    const item = createElement('article', 'education-item', '');
    item.append(createElement('span', 'education-years', period));
    const details = createElement('div', '', '');
    details.append(createElement('h3', '', titleText), createElement('p', '', descriptionText));
    item.append(details);
    list.append(item);
  });
  return list;
}

function renderStaticProjects() {
  const projects = [
    ['01', 'Portfolio Website', 'Web', 'A personal portfolio built to present my background, skills, and projects in a polished, modern format.'],
    ['02', 'Business Landing Page', 'UI', 'A responsive landing page designed to showcase a brand, services, and conversion-focused calls to action.'],
    ['03', 'Task Manager App', 'JavaScript', 'A simple to-do application that allows users to add, complete, and remove tasks with a clean interface.'],
  ];

  return projects.map(([number, titleText, categoryText, descriptionText]) => {
    const article = createElement('article', 'project-card', '');
    const image = createElement('div', 'project-image', number);
    const body = createElement('div', 'project-body', '');
    const meta = createElement('div', 'project-meta', '');
    meta.append(createElement('h3', '', titleText), createElement('span', '', categoryText));
    const link = createElement('a', 'project-link', 'View details ');
    link.href = 'contact.html';
    const icon = createElement('i', '', '');
    icon.dataset.lucide = 'arrow-up-right';
    icon.setAttribute('aria-hidden', 'true');
    link.append(icon);
    body.append(meta, createElement('p', '', descriptionText), link);
    article.append(image, body);
    return article;
  });
}

function renderStaticFocus() {
  const focus = createElement('div', 'focus-grid', '');
  focus.id = 'pageFocus';
  [
    ['cpu', 'Computer Science', 'Developing a foundation in programming, computational thinking, and practical problem-solving.'],
    ['panels-top-left', 'Frontend Development', 'Building responsive interfaces with HTML, CSS, and JavaScript.'],
    ['activity', 'Athletic Mindset', 'Practicing discipline, consistency, and a drive to improve.'],
  ].forEach(([iconName, titleText, descriptionText], index) => {
    const item = createElement('article', 'focus-item', '');
    item.append(createElement('span', 'focus-number', String(index + 1).padStart(2, '0')));
    const icon = createElement('i', '', '');
    icon.dataset.lucide = iconName;
    icon.setAttribute('aria-hidden', 'true');
    item.append(icon, createElement('h3', '', titleText), createElement('p', '', descriptionText));
    focus.append(item);
  });
  return focus;
}

function renderBlock(block) {
  const section = createElement('section', 'page-block', '');
  section.append(createElement('h2', '', block.heading));

  if (block.type === 'about') {
    const copy = createElement('div', 'page-copy', '');
    copy.id = 'pageAboutParagraphs';
    copy.append(
      createElement('p', '', 'I’m pursuing a BSc in Computer Science at the University of Embu (2024–2028), building my foundation in programming, computational thinking, and problem-solving.'),
      createElement('p', '', 'Coding and athletics are two of my favorite interests. I enjoy turning ideas into useful digital experiences and bring an active, disciplined mindset to learning and building.'),
    );
    section.append(copy);
  } else if (block.type === 'skills') {
    section.append(renderStaticSkills());
  } else if (block.type === 'education' || block.type === 'degree') {
    if (block.type === 'degree') {
      section.append(createElement('div', 'info-grid', ''));
      const grid = section.lastElementChild;
      const degree = createElement('article', 'info-card', '');
      const icon = createElement('i', '', '');
      icon.dataset.lucide = 'graduation-cap';
      icon.setAttribute('aria-hidden', 'true');
      degree.append(icon, createElement('h3', '', 'BSc in Computer Science'), createElement('p', '', 'University of Embu (UoEm) · 2024–2028, currently pursuing'));
      grid.append(degree);
    } else {
      section.append(renderStaticEducation());
    }
  } else if (block.type === 'study-gallery') {
    const gallery = createElement('div', 'education-gallery', '');
    [
      ['assets/education-study.svg', 'Illustration of a student practicing programming at a laptop', 'Individual coding study'],
      ['assets/collaborative-learning.svg', 'Illustration of two students discussing code together', 'Collaborative learning'],
    ].forEach(([src, alt, caption]) => {
      const figure = createElement('figure', '', '');
      const image = createElement('img', '', '');
      image.src = src;
      image.alt = alt;
      image.loading = 'lazy';
      figure.append(image, createElement('figcaption', '', caption));
      gallery.append(figure);
    });
    section.append(gallery);
  } else if (block.type === 'projects') {
    const projects = createElement('div', 'projects-grid', '');
    projects.id = 'pageProjects';
    projects.append(...renderStaticProjects());
    section.append(projects);
  } else if (block.type === 'focus') {
    section.append(renderStaticFocus());
  } else if (block.type === 'athletics') {
    const grid = createElement('div', 'info-grid', '');
    [
      ['activity', 'An active interest', 'Athletics is one of my hobbies alongside coding and my Computer Science studies.'],
      ['target', 'Discipline', 'Training and staying active help me value regular effort and steady progress.'],
      ['refresh-cw', 'Balance', 'I enjoy balancing technical learning with an active life outside the classroom.'],
    ].forEach(([iconName, titleText, descriptionText]) => {
      const card = createElement('article', 'info-card', '');
      const icon = createElement('i', '', '');
      icon.dataset.lucide = iconName;
      icon.setAttribute('aria-hidden', 'true');
      card.append(icon, createElement('h3', '', titleText), createElement('p', '', descriptionText));
      grid.append(card);
    });
    section.append(grid);
    const image = createElement('figure', 'feature-image', '');
    const illustration = createElement('img', '', '');
    illustration.src = 'assets/athletics-balance.svg';
    illustration.alt = 'Illustration of an athlete running on a track beside a campus';
    illustration.loading = 'lazy';
    image.append(illustration, createElement('figcaption', '', 'Athletics as part of a balanced student life'));
    section.append(image);
  } else if (block.type === 'athletic-focus') {
    section.append(createElement('div', 'page-copy', 'Athletics is a personal hobby, not a list of claimed competition results. I value consistency and focus and bring those habits to my studies and coding practice.'));
  } else if (block.type === 'coding') {
    const grid = createElement('div', 'info-grid', '');
    [
      ['code-xml', 'Build and learn', 'I use coding to explore ideas, strengthen my problem-solving, and create useful web experiences.'],
      ['panels-top-left', 'Web interfaces', 'I am especially interested in clear, accessible, responsive frontends.'],
      ['book-open-check', 'Keep improving', 'I am continuing to develop my software engineering skills through study and hands-on practice.'],
    ].forEach(([iconName, titleText, descriptionText]) => {
      const card = createElement('article', 'info-card', '');
      const icon = createElement('i', '', '');
      icon.dataset.lucide = iconName;
      icon.setAttribute('aria-hidden', 'true');
      card.append(icon, createElement('h3', '', titleText), createElement('p', '', descriptionText));
      grid.append(card);
    });
    section.append(grid);
    const image = createElement('figure', 'feature-image', '');
    const illustration = createElement('img', '', '');
    illustration.src = 'assets/coding-focus.svg';
    illustration.alt = 'Illustration of a developer planning and writing software';
    illustration.loading = 'lazy';
    image.append(illustration, createElement('figcaption', '', 'Curiosity, practice, and problem-solving'));
    section.append(image);
  } else if (block.type === 'contacts') {
    const contacts = createElement('div', 'contact-links', '');
    contacts.id = 'pageContacts';
    section.append(contacts);
  } else if (block.type === 'contact-note') {
    section.append(createElement('div', 'page-copy', 'I’m a software engineer and Computer Science student at the University of Embu. I’m open to genuine conversations about software, coding, and collaboration.'));
  }

  return section;
}

if (pageDefinition && pageRoot) {
  const navigationItems = pageLinks.map(({ file, label, icon }) => {
    const link = createElement('a', '', '');
    link.href = file;
    link.dataset.page = file;
    const iconElement = createElement('i', '', '');
    iconElement.dataset.lucide = icon;
    iconElement.setAttribute('aria-hidden', 'true');
    link.append(iconElement, document.createTextNode(label));
    return link;
  });
  [
    { href: 'account.html', label: 'Visitor sign in', icon: 'log-in' },
    { href: 'account.html?mode=register', label: 'Create account', icon: 'user-plus' },
    { href: '/admin', label: 'Private admin sign in', icon: 'shield-check' },
  ].forEach(({ href, label, icon }) => {
    const link = createElement('a', '', '');
    link.href = href;
    const iconElement = createElement('i', '', '');
    iconElement.dataset.lucide = icon;
    iconElement.setAttribute('aria-hidden', 'true');
    link.append(iconElement, document.createTextNode(label));
    navigationItems.push(link);
  });

  const header = createElement('header', 'topbar', '');
  const navWrap = createElement('div', 'container nav', '');
  const brand = createElement('a', 'brand', 'David Macharia Kimani');
  brand.href = 'index.html';
  brand.setAttribute('data-portfolio-name', '');
  const navigation = createElement('nav', 'nav-links', '');
  navigation.id = 'navLinks';
  navigation.setAttribute('aria-label', 'Main navigation');
  navigation.append(...navigationItems);
  const themeButton = createElement('button', 'theme-toggle', '');
  themeButton.id = 'themeToggle';
  themeButton.type = 'button';
  themeButton.setAttribute('aria-label', 'Switch to dark theme');
  themeButton.setAttribute('aria-pressed', 'false');
  themeButton.title = 'Switch to dark theme';
  [['theme-icon-moon', 'moon'], ['theme-icon-sun', 'sun']].forEach(([className, iconName]) => {
    const icon = createElement('i', className, '');
    icon.dataset.lucide = iconName;
    icon.setAttribute('aria-hidden', 'true');
    themeButton.append(icon);
  });
  const menuButton = createElement('button', 'menu-toggle', '');
  menuButton.id = 'menuToggle';
  menuButton.type = 'button';
  menuButton.setAttribute('aria-label', 'Open navigation menu');
  menuButton.setAttribute('aria-controls', 'navLinks');
  menuButton.setAttribute('aria-expanded', 'false');
  [['menu-icon-open', 'menu'], ['menu-icon-close', 'x']].forEach(([className, iconName]) => {
    const icon = createElement('i', className, '');
    icon.dataset.lucide = iconName;
    icon.setAttribute('aria-hidden', 'true');
    menuButton.append(icon);
  });
  navWrap.append(brand, navigation, themeButton, menuButton);
  header.append(navWrap);

  const main = createElement('main', '', '');
  const intro = createElement('section', 'page-intro', '');
  const introContainer = createElement('div', 'container', '');
  introContainer.append(
    createElement('p', 'eyebrow', pageDefinition.eyebrow),
    createElement('h1', '', pageDefinition.title),
    createElement('p', 'page-lede', pageDefinition.lede),
  );
  intro.append(introContainer);
  const pageBody = createElement('section', 'page-body', '');
  const content = createElement('div', 'container page-content', '');
  content.append(...pageDefinition.blocks.map(renderBlock));
  pageBody.append(content);
  main.append(intro, pageBody);

  const footer = createElement('footer', '', '');
  const footerRow = createElement('div', 'container footer-row', '');
  const copyright = createElement('span', '', '');
  copyright.append(document.createTextNode('© '));
  const year = createElement('span', '', String(new Date().getFullYear()));
  year.id = 'year';
  copyright.append(year, document.createTextNode(' '));
  const footerName = createElement('span', '', 'David Macharia Kimani');
  footerName.setAttribute('data-portfolio-name', '');
  copyright.append(footerName);
  footerRow.append(copyright, createElement('span', '', 'Built with HTML, CSS & JavaScript'));
  footer.append(footerRow);

  pageRoot.replaceWith(header, main, footer);
  if (window.lucide?.createIcons) window.lucide.createIcons();
}
