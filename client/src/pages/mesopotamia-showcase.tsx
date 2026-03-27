import { useLocation } from "wouter";
import MesopotamiaCityStatesShowcase from "@/components/mesopotamia-city-states-showcase";

export default function MesopotamiaShowcasePage() {
  const [, navigate] = useLocation();

  return (
    <MesopotamiaCityStatesShowcase
      isOpen={true}
      onClose={() => navigate("/")}
      embedded
    />
  );
}
