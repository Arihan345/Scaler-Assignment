import { GalleryVertical } from "lucide-react";

export default function StoriesHome() {
  return (
    <div className="welcome welcome--quiet">
      <GalleryVertical size={64} strokeWidth={1.4} />
      <p>Click to view a story</p>
    </div>
  );
}
