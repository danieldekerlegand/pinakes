// Simple script to trigger language family re-scraping with database clearing
async function resetLanguageFamilies() {
  try {
    console.log('Triggering fresh language family scrape with database clearing...');
    
    const response = await fetch('http://localhost:3050/api/scrape-language-families', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clearBeforeScrape: true })
    });
    
    if (response.ok) {
      console.log('✅ Scrape triggered successfully with database clearing');
      console.log('The new hierarchical logic will now be applied!');
    } else {
      console.log('❌ Failed to trigger scrape:', response.status, response.statusText);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

resetLanguageFamilies();
