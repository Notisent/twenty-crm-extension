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

    // Company priority:
    // 1. Experience section leaves[1] first segment — the actual employer list, most accurate
    // 2. scrapeCurrentCompanyFromProfile — explicit link/button (also gives LinkedIn URL)
    // 3. topCardPs[1] first segment — header concatenates multiple employers with "·"; take first only
    // (headline extraction removed: too unreliable when person has multiple roles/employers)
    const experienceData = scrapeFirstExperience();

    let currentCompany = experienceData?.currentCompany || '';
    let currentCompanyLinkedInUrl: string | undefined;

    if (!currentCompany) {
      const companyData = scrapeCurrentCompanyFromProfile();
      if (companyData?.name) {
        currentCompany = companyData.name;
        currentCompanyLinkedInUrl = companyData.linkedinUrl;
      }
    }

    if (!currentCompany && topCardPs[1]) {
      currentCompany = topCardPs[1].textContent?.trim().split('·')[0].trim() || '';
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

// Scrape company page data from LinkedIn
export function scrapeCompanyPage(): LinkedInCompanyData | null {
  try {
    const linkedinUrl = window.location.href.split('?')[0];

    // Company name: new LinkedIn uses h2, old used h1
    const nameElement =
      document.querySelector('main h1') ||
      document.querySelector('main h2') ||
      document.querySelector('h1.org-top-card-summary__title') ||
      document.querySelector('h1[title]');

    if (!nameElement) {
      console.warn('Could not find company name element');
      return null;
    }

    const name = nameElement.textContent?.trim() || '';

    // Employee count: look for text containing "employees"
    let employeeCount = '';
    document.querySelectorAll('main p, main span, main dd, main li').forEach((el) => {
      const text = el.textContent?.trim() || '';
      if (
        el.childElementCount === 0 &&
        (text.includes('employees') || text.includes('Beschäftigte') || text.includes('empleados'))
      ) {
        employeeCount = text;
      }
    });

    // Website
    const websiteElement =
      document.querySelector('a[data-control-name="top_card_link_website"]') ||
      document.querySelector('a[href*="http"]:not([href*="linkedin.com"])');
    const website = websiteElement?.getAttribute('href') || '';

    // Industry / description
    const descElement = document.querySelector('.org-top-card-summary__tagline');
    const description = descElement?.textContent?.trim() || '';

    return {
      type: 'company',
      linkedinUrl,
      name,
      website: website || undefined,
      employeeCount: employeeCount || undefined,
      description: description || undefined,
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

// Scrape the first (most recent) experience entry from the experience section
function scrapeFirstExperience(): {
  jobTitle?: string;
  currentCompany?: string;
  employmentType?: 'FULL_TIME' | 'PART_TIME' | 'SELF_EMPLOYED' | 'FREELANCE' | 'CONTRACT' | 'INTERNSHIP';
  jobStartDate?: string;
  workArrangement?: 'ON_SITE' | 'HYBRID' | 'REMOTE';
  jobDescription?: string;
} | null {
  try {
    // Find the experience section by its H2 heading text (works across all locales)
    const sections = Array.from(document.querySelectorAll('section'));
    const expSection = sections.find((s) => {
      const h2 = s.querySelector('h2');
      const text = h2?.textContent?.trim() || '';
      return /^(Erfahrung|Experience|Expérience|Experiencia|Esperienza|Erfaring|Doświadczenie|Experiência)$/i.test(text);
    });

    if (!expSection) return null;

    // Collect all leaf elements (no child elements, non-empty text), skipping the H2 heading
    const leaves = Array.from(expSection.querySelectorAll('*')).filter(
      (el) => el.childElementCount === 0 && (el.textContent?.trim().length ?? 0) > 0 && el.tagName !== 'H2'
    );

    if (leaves.length < 2) return null;

    // LinkedIn experience entry structure (leaf P elements in order):
    // [0] P  → job title           e.g. "Lead Software Engineer"
    // [1] P  → company · type      e.g. "GlobalLogic · Vollzeit"
    // [2] P  → date · duration     e.g. "Apr. 2023–Heute · 3 Jahre 2 Monate"
    // [3] P  → location · arrange  e.g. "Berlin, Deutschland · Hybrid"
    // [4] SPAN → description text

    const jobTitle = leaves[0]?.textContent?.trim() || undefined;

    // leaves[1] = "Company · EmploymentType" or just "EmploymentType" (when company isn't shown)
    let currentCompany: string | undefined;
    let employmentType: 'FULL_TIME' | 'PART_TIME' | 'SELF_EMPLOYED' | 'FREELANCE' | 'CONTRACT' | 'INTERNSHIP' | undefined;
    if (leaves[1]) {
      const raw = leaves[1].textContent?.trim() || '';
      const parts = raw.split('·').map((s) => s.trim());
      if (parts.length >= 2) {
        // "Company · EmploymentType" — unambiguous
        currentCompany = parts[0] || undefined;
        employmentType = parseEmploymentType(parts[1]);
      } else {
        // Single segment: could be a company name OR just an employment type keyword
        // Only treat as company name if it doesn't match any employment type
        const asType = parseEmploymentType(raw);
        if (asType) {
          employmentType = asType;
          // company name not available from this leaf; leave currentCompany undefined
        } else {
          currentCompany = raw || undefined;
        }
      }
    }

    let jobStartDate: string | undefined;
    if (leaves[2]) {
      const dateLine = leaves[2].textContent?.trim() || '';
      const startPart = dateLine.split(/[–\-]/)[0].trim().replace(/\s*·.*$/, '');
      jobStartDate = parseLinkedInDate(startPart) || undefined;
    }

    let workArrangement: 'ON_SITE' | 'HYBRID' | 'REMOTE' | undefined;
    if (leaves[3]) {
      const locLine = leaves[3].textContent?.trim() || '';
      const parts = locLine.split('·').map((s) => s.trim());
      if (parts.length >= 2) workArrangement = parseWorkArrangement(parts[1]);
    }

    // Description is typically a SPAN (not P) immediately after the 4 metadata P elements
    const descEl = leaves.find((el) => el.tagName === 'SPAN');
    const jobDescription = descEl?.textContent?.trim() || undefined;

    return { jobTitle, currentCompany, employmentType, jobStartDate, workArrangement, jobDescription };
  } catch (error) {
    console.error('Error scraping experience section:', error);
    return null;
  }
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
