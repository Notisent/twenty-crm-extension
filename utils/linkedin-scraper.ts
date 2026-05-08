import type { LinkedInProfileData, LinkedInCompanyData, LinkedInData } from '../types';

// Detect page type from URL
export function getLinkedInPageType(url: string): 'person' | 'company' | null {
  if (url.includes('linkedin.com/in/')) {
    return 'person';
  }
  if (url.includes('linkedin.com/company/')) {
    return 'company';
  }
  return null;
}

// Extract LinkedIn profile identifier from URL
export function getLinkedInIdentifier(url: string): string | null {
  const personMatch = url.match(/linkedin\.com\/in\/([^/?]+)/);
  if (personMatch) return personMatch[1];

  const companyMatch = url.match(/linkedin\.com\/company\/([^/?]+)/);
  if (companyMatch) return companyMatch[1];

  return null;
}

// Scrape person profile data from LinkedIn page
export function scrapePersonProfile(): LinkedInProfileData | null {
  try {
    const linkedinUrl = window.location.href.split('?')[0];

    // Name: new LinkedIn uses h2 (not h1) with hashed class names.
    // Fall back to h1 for older layouts, then page title.
    const nameElement =
      document.querySelector('main h2') ||
      document.querySelector('h1.text-heading-xlarge') ||
      document.querySelector('h1[class*="break-words"]') ||
      document.querySelector('h1');

    let fullName = nameElement?.textContent?.trim() || '';
    if (!fullName) {
      const titleMatch = document.title.match(/^(.+?)\s*\|/);
      fullName = titleMatch ? titleMatch[1].trim() : '';
    }

    if (!fullName) {
      console.warn('Could not find profile name');
      return null;
    }

    const nameParts = parseFullName(fullName);

    // Headline, company, location: LinkedIn's new DOM puts these as <p> elements
    // inside the first <section> of <main>, in a predictable order after connection
    // degree indicators ("· 1.", "· 2.").
    const firstSection = document.querySelector('main section');
    const topCardPs = firstSection
      ? Array.from(firstSection.querySelectorAll('p')).filter((p) => {
          const text = p.textContent?.trim() || '';
          return (
            text.length > 2 &&
            !text.match(/^·\s*\d+\.?$/) &&           // "· 1." "· 2."
            !text.match(/^\d+\s*(Kontakte|connections?|contacts?)/i) && // "63 Kontakte"
            !text.match(/^\d+$/)                      // bare numbers
          );
        })
      : [];

    const headline = topCardPs[0]?.textContent?.trim() || '';

    // Company extraction — four fallbacks in order of reliability:
    // 1. Explicit company link/button in top card (gives LinkedIn URL too)
    // 2. Experience section first entry company (only if section loaded in DOM)
    // 3. "bei/at/chez" pattern in headline — e.g. "Engineer bei Acme" → "Acme"
    // 4. topCardPs[1] split on "·", skipping education institution segments
    //    (LinkedIn top card concatenates employers AND universities with "·")
    let currentCompany = '';
    let currentCompanyLinkedInUrl: string | undefined;

    const companyData = scrapeCurrentCompanyFromProfile();
    if (companyData?.name) {
      currentCompany = companyData.name;
      currentCompanyLinkedInUrl = companyData.linkedinUrl;
    }

    const experienceData = scrapeFirstExperience();

    if (!currentCompany && experienceData?.currentCompany) {
      currentCompany = experienceData.currentCompany;
      if (experienceData.currentCompanyLinkedInUrl && !currentCompanyLinkedInUrl) {
        currentCompanyLinkedInUrl = experienceData.currentCompanyLinkedInUrl;
      }
    }

    if (!currentCompany) {
      currentCompany = extractCompanyFromHeadline(headline) || '';
    }

    if (!currentCompany && topCardPs[1]) {
      const segments = (topCardPs[1].textContent?.trim() || '').split('·').map(s => s.trim()).filter(Boolean);
      const companySegment = segments.find(s => !isEducationInstitution(s));
      currentCompany = companySegment || '';
    }

    // Location: third meaningful p (or second if no company found yet)
    const location = topCardPs[2]?.textContent?.trim() ||
      topCardPs[1]?.textContent?.trim() || '';

    const profileImageUrl = scrapeProfileImage();

    return {
      type: 'person' as const,
      linkedinUrl,
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      headline,
      currentCompany,
      currentCompanyLinkedInUrl,
      profileImageUrl: profileImageUrl || undefined,
      location: location || undefined,
      jobTitleFromExperience: experienceData?.jobTitle || undefined,
      employmentType: experienceData?.employmentType || undefined,
      jobStartDate: experienceData?.jobStartDate || undefined,
      workArrangement: experienceData?.workArrangement || undefined,
      jobDescription: experienceData?.jobDescription || undefined,
    };
  } catch (error) {
    console.error('Error scraping person profile:', error);
    return null;
  }
}

// Scrape profile image
function scrapeProfileImage(): string {
  // New LinkedIn: profile photo is the first img in main section whose src
  // contains "profile-displayphoto" on the LinkedIn media CDN.
  const mainSection = document.querySelector('main section');
  if (mainSection) {
    const imgs = Array.from(mainSection.querySelectorAll('img')) as HTMLImageElement[];
    const profileImg = imgs.find(
      (img) => img.src?.includes('profile-displayphoto') || img.src?.includes('profile-display')
    );
    if (profileImg?.src) return profileImg.src;

    // Fallback: first CDN image that looks like a person photo
    const cdnImg = imgs.find(
      (img) => img.src?.includes('media.licdn.com') && img.src?.includes('profile')
    );
    if (cdnImg?.src) return cdnImg.src;
  }

  // Legacy selectors
  const legacySelectors = [
    '.pv-top-card-profile-picture__container img',
    '.pv-top-card-profile-picture__image',
    'img.profile-photo-edit__preview',
    '.pv-top-card__photo img',
    'button[aria-label*="image"] img',
    '.EntityPhoto-circle-9 img',
  ];
  for (const selector of legacySelectors) {
    const img = document.querySelector(selector) as HTMLImageElement;
    if (img?.src && !img.src.includes('ghost') && img.src.includes('profile')) {
      return img.src;
    }
  }

  return '';
}

// Scrape company info from current profile page
function scrapeCurrentCompanyFromProfile(): { name: string; linkedinUrl?: string } | null {
  try {
    // Aria-label button (works on some LinkedIn versions/locales)
    const companyButton =
      document.querySelector('button[aria-label*="Entreprise actuelle"]') ||
      document.querySelector('button[aria-label*="Current company"]') ||
      document.querySelector('button[aria-label*="Empresa actual"]') ||
      document.querySelector('button[aria-label*="Aktuelles Unternehmen"]') ||
      document.querySelector('button[aria-label*="Huidige werkgever"]');

    if (companyButton) {
      const ariaLabel = companyButton.getAttribute('aria-label') || '';
      const nameMatch = ariaLabel.match(/:\s*([^.]+)/);
      const name = nameMatch ? nameMatch[1].trim() : '';
      if (name) return { name };
    }

    // Company link in top card or experience section
    const companyLink =
      document.querySelector('a[href*="/company/"][aria-label]') ||
      document.querySelector('.pv-text-details__right-panel-item-text a[href*="/company/"]') ||
      document.querySelector('a[data-field="experience_company_logo"]');

    if (companyLink) {
      const href = companyLink.getAttribute('href') || '';
      const match = href.match(/\/company\/([^/?]+)/);
      const linkedinUrl = match
        ? `https://www.linkedin.com/company/${match[1]}/`
        : undefined;
      const name = companyLink.getAttribute('aria-label') ||
        companyLink.textContent?.trim() || '';
      if (name) return { name, linkedinUrl };
    }

    return null;
  } catch (error) {
    console.error('Error scraping company from profile:', error);
    return null;
  }
}

// Scrape company page data from LinkedIn.
// Works on both /company/slug/ (overview) and /company/slug/about/ pages.
// The about page has a <dl> with labeled fields; the overview page has fewer fields.
export function scrapeCompanyPage(): LinkedInCompanyData | null {
  try {
    const linkedinUrl = window.location.href.split('?')[0].replace(/\/about\/?$/, '/');

    // Company name: always an H1 on company pages
    const name = document.querySelector('main h1')?.textContent?.trim() || '';
    if (!name) {
      console.warn('Could not find company name element');
      return null;
    }

    // Logo: square profile image has alt="Logo für <name>" / "Logo for <name>"
    const logoImg = Array.from(document.querySelectorAll('main img')).find(
      (img) => /logo/i.test((img as HTMLImageElement).alt)
    ) as HTMLImageElement | undefined;
    const logoUrl = logoImg?.src || undefined;

    // Find the overview/about section by H2 label (localised)
    const sections = Array.from(document.querySelectorAll('main section'));
    const overviewSection = sections.find((s) =>
      /^(Übersicht|Overview|Aperçu|Información general|Panoramica)/i.test(
        s.querySelector('h2')?.textContent?.trim() || ''
      )
    );

    // Description: first P directly inside the overview section
    const description = overviewSection?.querySelector('p')?.textContent?.trim() || undefined;

    // DL-based field extractor — works on the about page.
    // Structure: <dt><h3>Label</h3></dt><dd>Value</dd>  (or <a href> for website)
    function getDlField(...labels: string[]): string {
      if (!overviewSection) return '';
      for (const label of labels) {
        const dt = Array.from(overviewSection.querySelectorAll('dt')).find((dt) =>
          dt.querySelector('h3')?.textContent?.trim().toLowerCase() === label.toLowerCase()
        );
        if (!dt) continue;
        // Nearest following <dd> sibling
        let el: Element | null = dt.nextElementSibling;
        while (el) {
          if (el.tagName === 'DD') return el.textContent?.trim() || '';
          el = el.nextElementSibling;
        }
        // Fallback: same-index DD in the parent DL
        const dl = dt.closest('dl');
        if (dl) {
          const dtIdx = Array.from(dl.querySelectorAll('dt')).indexOf(dt);
          const dd = dl.querySelectorAll('dd')[dtIdx];
          if (dd) return dd.textContent?.trim() || '';
        }
      }
      return '';
    }

    // Website: the DT sibling contains an <a href> rather than a plain DD
    function getWebsite(): string {
      if (!overviewSection) return '';
      const dt = Array.from(overviewSection.querySelectorAll('dt')).find((dt) =>
        /^website$/i.test(dt.querySelector('h3')?.textContent?.trim() || '')
      );
      if (!dt) {
        // Fallback: any external link in the overview section
        const a = overviewSection.querySelector('a[href^="http"]:not([href*="linkedin.com"])');
        return a?.getAttribute('href') || a?.textContent?.trim() || '';
      }
      // Search next few siblings for an external link
      let el: Element | null = dt.nextElementSibling;
      for (let i = 0; i < 4 && el; i++, el = el.nextElementSibling) {
        const a = (el.tagName === 'A' ? el : el.querySelector('a[href]')) as HTMLAnchorElement | null;
        const href = a?.getAttribute('href') || '';
        if (href && !href.startsWith('/') && !href.startsWith('tel:') && !href.includes('linkedin.com')) {
          return href;
        }
        // The SPAN inside the A often holds the display URL
        const span = el.querySelector('span');
        if (span?.textContent?.trim().startsWith('http')) return span.textContent.trim();
      }
      return '';
    }

    const website = getWebsite();
    const industry = getDlField('Branche', 'Industry', 'Sector', 'Secteur', 'Industria', 'Settore');
    const employeeCount = getDlField('Größe', 'Size', 'Taille', 'Tamaño', 'Dimensione');
    const headquarters = getDlField('Hauptsitz', 'Headquarters', 'Siège social', 'Sede', 'Sede centrale');

    // Phone: DT sibling has a tel: link
    const phoneDt = Array.from(overviewSection?.querySelectorAll('dt') || []).find((dt) =>
      /^(telefon|phone|téléphone|teléfono|telefono)$/i.test(dt.querySelector('h3')?.textContent?.trim() || '')
    );
    let phone: string | undefined;
    if (phoneDt) {
      let el: Element | null = phoneDt.nextElementSibling;
      for (let i = 0; i < 4 && el; i++, el = el.nextElementSibling) {
        const a = (el.tagName === 'A' ? el : el.querySelector('a[href^="tel:"]')) as HTMLAnchorElement | null;
        const span = el.querySelector('span');
        const text = a?.getAttribute('href')?.replace('tel:', '') || span?.textContent?.trim();
        if (text) { phone = text; break; }
      }
    }

    // Prefer the precise "assoziierte Mitglieder / associated members" count over the
    // vague DL range ("11 bis 50 Beschäftigte"). Extract the leading number from the link.
    const associatedMembersLink = Array.from(document.querySelectorAll('main a')).find((a) =>
      /\d+\s*(assoziierte|associated)/i.test(a.textContent?.trim() || '')
    );
    const associatedMembersCount = associatedMembersLink
      ? associatedMembersLink.textContent?.trim().match(/^(\d+)/)?.[1]
      : undefined;

    // Fallback employee count from link text (overview page only, when DL not present)
    const employeeCountFallback = !employeeCount
      ? (() => {
          const link = Array.from(document.querySelectorAll('main a')).find((a) =>
            /\d.*(Beschäftigte|employees|empleados)/i.test(a.textContent?.trim() || '')
          );
          return link?.textContent?.trim() || '';
        })()
      : '';

    return {
      type: 'company',
      linkedinUrl,
      name,
      logoUrl,
      website: website || undefined,
      industry: industry || undefined,
      employeeCount: associatedMembersCount || employeeCount || employeeCountFallback || undefined,
      description: description || undefined,
      phone: phone || undefined,
      headquarters: headquarters || undefined,
    };
  } catch (error) {
    console.error('Error scraping company page:', error);
    return null;
  }
}

// Main scraper function that detects page type and scrapes accordingly
export function scrapeCurrentPage(): LinkedInData | null {
  const pageType = getLinkedInPageType(window.location.href);

  if (pageType === 'person') {
    return scrapePersonProfile();
  }

  if (pageType === 'company') {
    return scrapeCompanyPage();
  }

  return null;
}

// Scrape the first (most recent) experience entry from the experience section.
//
// LinkedIn renders two distinct entry shapes:
//
// A) Nested/grouped — person held multiple roles at one company:
//    <a href="/company/...">          ← NOT inside <ul>
//      <p>Herodikos</p>               ← company name
//      <p>Vollzeit · 6 Jahre 2 Monate</p>  ← employment type · total tenure
//    </a>
//    <ul>                              ← sibling UL (roles)
//      <li>
//        <a href="/company/...">
//          <p>Geschäftsführer, Product & Operations</p>  ← job title
//          <p>Mai 2023–Heute · 3 Jahre 1 Monat</p>        ← date
//          <p>Oldenburg … · Hybrid</p>                    ← location · arrangement
//        </a>
//      </li>
//      ...
//    </ul>
//
// B) Simple — single role at a company with a LinkedIn page:
//    <a href="/company/...">          ← NOT inside <ul>
//      <p>Product Owner</p>           ← job title
//      <p>worldiety GmbH · Vollzeit</p>   ← company · type
//      <p>Feb. 2013–Apr. 2019 · …</p>    ← date
//      <p>Oldenburg …</p>                 ← location
//    </a>
//
// C) Simple — role at a company without a LinkedIn page (no <a href>):
//    leaf Ps in DOM order: title, company name, date range
function scrapeFirstExperience(): {
  jobTitle?: string;
  currentCompany?: string;
  currentCompanyLinkedInUrl?: string;
  employmentType?: 'FULL_TIME' | 'PART_TIME' | 'SELF_EMPLOYED' | 'FREELANCE' | 'CONTRACT' | 'INTERNSHIP';
  jobStartDate?: string;
  workArrangement?: 'ON_SITE' | 'HYBRID' | 'REMOTE';
  jobDescription?: string;
} | null {
  try {
    const sections = Array.from(document.querySelectorAll('section'));
    const expSection = sections.find((s) => {
      const h2 = s.querySelector('h2');
      const text = h2?.textContent?.trim() || '';
      return /^(Erfahrung|Experience|Expérience|Experiencia|Esperienza|Erfaring|Doświadczenie|Experiência)$/i.test(text);
    });

    if (!expSection) return null;

    // Find top-level company links — <a href="/company/..."> that are NOT nested inside a <ul>
    // (links inside <ul> are individual roles within a nested group, handled separately below)
    const topLevelLinks = Array.from(
      expSection.querySelectorAll('a[href*="/company/"]')
    ).filter((a) => !a.closest('ul') && a.querySelector('p')) as HTMLElement[];

    if (topLevelLinks.length > 0) {
      const firstLink = topLevelLinks[0];
      const ps = Array.from(firstLink.querySelectorAll('p'));
      const href = firstLink.getAttribute('href') || '';
      const currentCompanyLinkedInUrl = href.includes('linkedin.com') ? href : (href ? `https://www.linkedin.com${href}` : undefined);

      const p0 = ps[0]?.textContent?.trim() || '';
      const p1 = ps[1]?.textContent?.trim() || '';
      const p1Parts = p1.split('·').map((s) => s.trim());

      // Distinguish shape A from shape B:
      // Shape A (nested group header): exactly 2 Ps, and P[1]'s second segment is a duration
      // Shape B (simple entry): 3-4 Ps, P[1] = "Company · EmploymentType"
      const secondSegmentIsDuration = /\d+\s*(Jahr|Monat|Month|Year|Año|Ano)/i.test(p1Parts[1] || '');
      const isNestedGroup = ps.length === 2 && secondSegmentIsDuration;

      if (isNestedGroup) {
        // Shape A: P[0] = company, P[1] = "EmploymentType · TotalDuration"
        const currentCompany = p0 || undefined;
        const employmentType = parseEmploymentType(p1Parts[0]);

        // Find the sibling UL containing the individual roles
        let el: Element | null = firstLink;
        let groupUl: HTMLUListElement | null = null;
        while (el && el !== expSection) {
          if (el.tagName === 'DIV') {
            const candidate = el.querySelector(':scope > ul') as HTMLUListElement | null;
            if (candidate) { groupUl = candidate; break; }
          }
          el = el.parentElement;
        }

        let jobTitle: string | undefined;
        let jobStartDate: string | undefined;
        let workArrangement: 'ON_SITE' | 'HYBRID' | 'REMOTE' | undefined;

        const firstLi = groupUl?.querySelector('li');
        if (firstLi) {
          const rolePs = Array.from(firstLi.querySelectorAll('p'));
          jobTitle = rolePs[0]?.textContent?.trim() || undefined;
          const dateLine = rolePs[1]?.textContent?.trim() || '';
          const startPart = dateLine.split(/[–\-]/)[0].trim().replace(/\s*·.*$/, '');
          jobStartDate = parseLinkedInDate(startPart) || undefined;
          const locLine = rolePs[2]?.textContent?.trim() || '';
          const locParts = locLine.split('·').map((s) => s.trim());
          if (locParts.length >= 2) workArrangement = parseWorkArrangement(locParts[1]);
        }

        return { jobTitle, currentCompany, currentCompanyLinkedInUrl, employmentType, jobStartDate, workArrangement };

      } else {
        // Shape B: P[0] = title, P[1] = "Company · EmploymentType", P[2] = date, P[3] = location
        const jobTitle = p0 || undefined;
        const currentCompany = p1Parts[0] || undefined;
        const employmentType = p1Parts.length >= 2 ? parseEmploymentType(p1Parts[1]) : undefined;
        const dateLine = ps[2]?.textContent?.trim() || '';
        const startPart = dateLine.split(/[–\-]/)[0].trim().replace(/\s*·.*$/, '');
        const jobStartDate = parseLinkedInDate(startPart) || undefined;
        const locLine = ps[3]?.textContent?.trim() || '';
        const locParts = locLine.split('·').map((s) => s.trim());
        const workArrangement = locParts.length >= 2 ? parseWorkArrangement(locParts[1]) : undefined;

        return { jobTitle, currentCompany, currentCompanyLinkedInUrl, employmentType, jobStartDate, workArrangement };
      }
    }

    // Shape C fallback: no company links — collect leaf Ps in order
    // Structure: P[0]=title, P[1]=company name, P[2]=date
    const leaves = Array.from(expSection.querySelectorAll('p')).filter(
      (el) => el.childElementCount === 0 && (el.textContent?.trim().length ?? 0) > 0
    );
    if (leaves.length < 1) return null;
    const jobTitle = leaves[0]?.textContent?.trim() || undefined;
    let currentCompany: string | undefined;
    let employmentType: 'FULL_TIME' | 'PART_TIME' | 'SELF_EMPLOYED' | 'FREELANCE' | 'CONTRACT' | 'INTERNSHIP' | undefined;
    if (leaves[1]) {
      const raw = leaves[1].textContent?.trim() || '';
      const asType = parseEmploymentType(raw);
      if (asType) employmentType = asType;
      else currentCompany = raw || undefined;
    }
    let jobStartDate: string | undefined;
    if (leaves[2]) {
      const dateLine = leaves[2].textContent?.trim() || '';
      const startPart = dateLine.split(/[–\-]/)[0].trim().replace(/\s*·.*$/, '');
      jobStartDate = parseLinkedInDate(startPart) || undefined;
    }
    return { jobTitle, currentCompany, employmentType, jobStartDate };

  } catch (error) {
    console.error('Error scraping experience section:', error);
    return null;
  }
}

// Detect whether a name segment is an educational institution so it can be
// excluded when picking the company name from a "·"-joined top-card string.
function isEducationInstitution(name: string): boolean {
  return /universit|hochschule|fachhochschule|college|school|akademie|academy|institute|institut|école|universidad|università/i.test(name);
}

// Map LinkedIn employment type strings to our enum
function parseEmploymentType(
  raw: string
): 'FULL_TIME' | 'PART_TIME' | 'SELF_EMPLOYED' | 'FREELANCE' | 'CONTRACT' | 'INTERNSHIP' | undefined {
  const normalized = raw.toLowerCase().trim();
  if (normalized.includes('vollzeit') || normalized.includes('full-time') || normalized.includes('full time')) return 'FULL_TIME';
  if (normalized.includes('teilzeit') || normalized.includes('part-time') || normalized.includes('part time')) return 'PART_TIME';
  if (normalized.includes('selbstständig') || normalized.includes('self-employed') || normalized.includes('selbständig')) return 'SELF_EMPLOYED';
  if (normalized.includes('freiberuflich') || normalized.includes('freelance')) return 'FREELANCE';
  if (normalized.includes('vertrag') || normalized.includes('contract')) return 'CONTRACT';
  if (normalized.includes('praktikum') || normalized.includes('internship')) return 'INTERNSHIP';
  return undefined;
}

// Map LinkedIn work arrangement strings to our enum
function parseWorkArrangement(
  raw: string
): 'ON_SITE' | 'HYBRID' | 'REMOTE' | undefined {
  const normalized = raw.toLowerCase().trim();
  if (normalized.includes('hybrid')) return 'HYBRID';
  if (normalized.includes('remote') || normalized.includes('homeoffice')) return 'REMOTE';
  if (normalized.includes('vor ort') || normalized.includes('on-site') || normalized.includes('on site')) return 'ON_SITE';
  return undefined;
}

// Parse LinkedIn date strings like "Feb. 2024", "Apr 2023", "2021" into YYYY-MM-DD
function parseLinkedInDate(raw: string): string | null {
  if (!raw) return null;
  const months: Record<string, string> = {
    jan: '01', feb: '02', mär: '03', mar: '03', apr: '04', mai: '05', may: '05',
    jun: '06', jul: '07', aug: '08', sep: '09', okt: '10', oct: '10',
    nov: '11', dez: '12', dec: '12',
  };
  const cleaned = raw.replace(/\./g, '').trim().toLowerCase();
  const parts = cleaned.split(/\s+/);
  if (parts.length >= 2) {
    const monthKey = parts[0].substring(0, 3);
    const month = months[monthKey];
    const year = parts[1];
    if (month && /^\d{4}$/.test(year)) {
      return `${year}-${month}-01`;
    }
  }
  if (parts.length === 1 && /^\d{4}$/.test(parts[0])) {
    return `${parts[0]}-01-01`;
  }
  return null;
}

// Helper to parse full name into first and last name
function parseFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);

  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };

  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

// Try to extract company name from headline like "Software Engineer at Google"
function extractCompanyFromHeadline(headline: string): string {
  const patterns = [
    /\bat\s+(.+?)(?:\s*\||$)/i,
    /\bchez\s+(.+?)(?:\s*\||$)/i,
    /\bbei\s+(.+?)(?:\s*\||$)/i,
    /\b@\s*(.+?)(?:\s*\||$)/i,
    /\bfor\s+(.+?)(?:\s*\||$)/i,
    /\bà\s+(.+?)(?:\s*\||$)/i,
    /\ben\s+(.+?)(?:\s*\||$)/i,
  ];

  for (const pattern of patterns) {
    const match = headline.match(pattern);
    if (match) return match[1].trim();
  }

  return '';
}
