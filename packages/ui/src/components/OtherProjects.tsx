const projects = [
  {
    url: 'https://lbajsarowicz.me',
    heading: 'Łukasz Bajsarowicz',
    description: 'E-commerce consultant & Adobe Commerce expert. Magento architecture, performance, and team leadership.',
  },
  {
    url: 'https://magento.watch',
    heading: 'magento.watch',
    description: 'Track Magento & MageOS version lifecycle. EOL dates, system requirements, and security patches at a glance.',
  },
  {
    url: 'https://mage-os.pl',
    heading: 'MageOS Poland',
    description: 'MageOS for the Polish market — the community-driven Magento fork with native Polish integrations.',
  },
];

export function OtherProjects() {
  return (
    <section className="border-t border-slate-800 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-8">
          Other projects by the author
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {projects.map((project) => (
            <a
              key={project.url}
              href={project.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block bg-slate-900/60 border border-slate-800 rounded-xl p-6 transition-all duration-200 hover:border-primary-500/50 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary-500/5"
            >
              <h3 className="font-display font-bold text-slate-100 mb-2">{project.heading}</h3>
              <p className="text-slate-400 text-sm leading-relaxed mb-4">{project.description}</p>
              <span className="text-primary-400 font-semibold text-sm">Visit →</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
