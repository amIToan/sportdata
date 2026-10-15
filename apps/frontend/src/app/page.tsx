import { HomeBannerSlider } from '@/components/home/HomeBannerSlider';
import { HomeNewsSection } from '@/components/home/HomeNewsSection';

export default function HomePage() {
  return (
    <div className="home-page min-h-screen">
      <HomeBannerSlider />
      <div className="home-content mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <HomeNewsSection />
      </div>
    </div>
  );
}
