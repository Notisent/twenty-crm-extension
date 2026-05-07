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
