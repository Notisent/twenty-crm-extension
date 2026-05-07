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

    // Company: second meaningful p, validated against known noise patterns.
    // Also try the aria-label button approach which works on some LinkedIn versions.
    let currentCompany = topCardPs[1]?.textContent?.trim() || '';
    let currentCompanyLinkedInUrl: string | undefined;

    const companyData = scrapeCurrentCompanyFromProfile();
    if (companyData?.name) {
      currentCompany = companyData.name;
      currentCompanyLinkedInUrl = companyData.linkedinUrl;
    }

    if (!currentCompany) {
      currentCompany = extractCompanyFromHeadline(headline);
    }

    // Location: third meaningful p (or second if no company found yet)
    const location = topCardPs[2]?.textContent?.trim() ||
      topCardPs[1]?.textContent?.trim() || '';

    const profileImageUrl = scrapeProfileImage();
    const experienceData = scrapeFirstExperience();

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
  employmentType?: 'FULL_TIME' | 'PART_TIME' | 'SELF_EMPLOYED' | 'FREELANCE' | 'CONTRACT' | 'INTERNSHIP';
  jobStartDate?: string;
  workArrangement?: 'ON_SITE' | 'HYBRID' | 'REMOTE';
  jobDescription?: string;
} | null {
  try {
    // LinkedIn experience section has id="experience" on the containing section or a nearby anchor
    const experienceAnchor =
      document.getElementById('experience') ||
      document.querySelector('[id^="experience"]');

    if (!experienceAnchor) return null;

    // Walk up to the section element that contains the experience list
    let experienceSection: Element | null = experienceAnchor;
    while (experienceSection && experienceSection.tagName !== 'SECTION') {
      experienceSection = experienceSection.parentElement;
    }
    if (!experienceSection) return null;

    // Each experience entry is an <li> inside a <ul>
    const firstEntry = experienceSection.querySelector('ul > li');
    if (!firstEntry) return null;

    // Extract all visible text nodes from meaningful leaf elements within the first entry
    const texts = Array.from(firstEntry.querySelectorAll('span[aria-hidden="true"]'))
      .map((el) => el.textContent?.trim() || '')
      .filter((t) => t.length > 0);

    if (texts.length === 0) return null;

    // texts[0]: job title
    // texts[1]: "Company · EmploymentType" or just "Company"
    // texts[2]: date range "Feb. 2024 – Heute · 2 J. 4 Mo." or "Apr. 2023 – ..."
    // texts[3]: location line "City, Region · WorkArrangement" or just "City, Region"
    // texts[4+]: description paragraphs

    const jobTitle = texts[0];

    // Parse employment type from the company·type line
    let employmentType: ReturnType<typeof scrapeFirstExperience> extends null ? never : NonNullable<ReturnType<typeof scrapeFirstExperience>>['employmentType'] = undefined;
    if (texts[1]) {
      const parts = texts[1].split('·').map((s) => s.trim());
      if (parts.length >= 2) {
        employmentType = parseEmploymentType(parts[1]);
      }
    }

    // Parse start date from date range line (first date before "–" or end of string)
    let jobStartDate: string | undefined;
    const dateLine = texts.find((t) => /\d{4}/.test(t) && (t.includes('–') || t.includes('-') || t.includes('heute') || t.includes('Heute') || t.includes('Present') || t.includes('present')));
    if (dateLine) {
      const startPart = dateLine.split(/[–-]/)[0].trim().replace(/\s*·.*$/, '');
      jobStartDate = parseLinkedInDate(startPart) || undefined;
    }

    // Parse work arrangement from location line
    let workArrangement: ReturnType<typeof scrapeFirstExperience> extends null ? never : NonNullable<ReturnType<typeof scrapeFirstExperience>>['workArrangement'] = undefined;
    const locationLine = texts.find((t) => {
      const lower = t.toLowerCase();
      return lower.includes('hybrid') || lower.includes('remote') || lower.includes('vor ort') || lower.includes('on-site') || lower.includes('on site');
    });
    if (locationLine) {
      const arrangementPart = locationLine.split('·').pop()?.trim() || '';
      workArrangement = parseWorkArrangement(arrangementPart);
    }

    // Description: remaining texts after the metadata lines (usually index 4+)
    // Heuristic: skip lines that look like metadata (dates, company names, locations)
    const descriptionTexts = texts.slice(4).filter((t) => {
      return (
        t.length > 30 &&
        !/^\d/.test(t) &&
        !t.match(/\d{4}/) &&
        !t.includes('·')
      );
    });
    const jobDescription = descriptionTexts.length > 0 ? descriptionTexts.join(' ') : undefined;

    return { jobTitle, employmentType, jobStartDate, workArrangement, jobDescription };
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
