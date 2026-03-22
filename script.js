const revealElements = document.querySelectorAll(
  ".hero-copy, .hero-panel, .trust-band, .section-heading, .metric-card, .info-card, .project-card, .timeline-card, .contact-card, .tool-cloud"
);

revealElements.forEach((element) => {
  element.classList.add("reveal");
});

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  },
  {
    threshold: 0.18,
  }
);

revealElements.forEach((element) => observer.observe(element));
