import HomePage from './HomePage'
import SiteLayout from './SiteLayout'

/**
 * The website's home page for a visitor at "/" (signed-in users get the dashboard
 * there). The other pages (/about, /services, …) are routes under SiteLayout.
 */
export default function LandingPage() {
  return (
    <SiteLayout>
      <HomePage />
    </SiteLayout>
  )
}
