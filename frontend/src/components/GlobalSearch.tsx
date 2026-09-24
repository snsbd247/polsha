import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AutoComplete, Input } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useAuth } from "../auth/AuthContext";
import { api, type Paginated } from "../lib/api";
import { digits } from "../lib/format";
import { t as tx } from "../lib/i18n";
import type { LandRow } from "../lib/land";

type FarmerHit = {
  id: number;
  farmer_code: string;
  name_bn: string;
  father_name: string;
  village: string | null;
  member_no: number | null;
};

/** Top-bar search: farmers (name, mobile, NID, Farmer ID, member no) and lands (Land ID, dag, khatian). Enter opens the full list. */
export default function GlobalSearch({
  width = 565,
}: {
  width?: number | string;
}) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [term, setTerm] = useState("");
  const [options, setOptions] = useState<
    {
      label: React.ReactNode;
      options: { value: string; label: React.ReactNode }[];
    }[]
  >([]);
  const canFarmer = can("farmer.view");
  const canLand = can("land.view");

  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) return;
    let live = true;
    const timer = window.setTimeout(async () => {
      const [farmers, lands] = await Promise.all([
        canFarmer
          ? api
              .get<FarmerHit[]>("/farmers/lookup", { params: { q } })
              .then((r) => r.data.slice(0, 6))
              .catch(() => [])
          : Promise.resolve([] as FarmerHit[]),
        canLand
          ? api
              .get<Paginated<LandRow>>("/lands", {
                params: { search: q, per_page: 5 },
              })
              .then((r) => r.data.data)
              .catch(() => [])
          : Promise.resolve([] as LandRow[]),
      ]);
      if (!live) return;
      const groups = [];
      if (farmers.length)
        groups.push({
          label: tx("কৃষক"),
          options: farmers.map((f) => ({
            value: `/farmers/${f.id}`,
            label: (
              <div style={{ lineHeight: 1.3 }}>
                <div>{f.name_bn}</div>
                <small style={{ color: "#6b7280" }}>
                  {digits(f.farmer_code)}
                  {f.member_no
                    ? ` · ${tx("সদস্য নং")} ${digits(f.member_no)}`
                    : ""}
                  {f.village ? ` · ${f.village}` : ""}
                </small>
              </div>
            ),
          })),
        });
      if (lands.length)
        groups.push({
          label: tx("জমি"),
          options: lands.map((l) => ({
            value: `/lands/${l.id}`,
            label: (
              <div style={{ lineHeight: 1.3 }}>
                <div>{digits(l.land_code)}</div>
                <small style={{ color: "#6b7280" }}>
                  {l.mouza ?? ""} · {tx("দাগ")} {digits(l.dag_no)} ·{" "}
                  {tx("খতিয়ান")} {digits(l.khatian_no)}
                </small>
              </div>
            ),
          })),
        });
      setOptions(groups);
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [term, canFarmer, canLand]);

  if (!canFarmer && !canLand) return <div style={{ flex: 1 }} />;

  return (
    <AutoComplete
      className="top-search"
      style={{ width, maxWidth: "100%" }}
      options={term.trim().length < 2 ? [] : options}
      value={term}
      onChange={setTerm}
      onSelect={(path: string) => {
        setTerm("");
        navigate(path);
      }}
    >
      <Input
        prefix={
          <SearchOutlined
            style={{ color: "#6b7280", fontSize: 16, marginInlineEnd: 6 }}
          />
        }
        placeholder={tx(
          "কৃষকের নাম, মোবাইল, NID, সদস্য নং, জমির নং দিয়ে খুঁজুন...",
        )}
        allowClear
        onPressEnter={() => {
          const q = term.trim();
          if (!q) return;
          navigate(
            canFarmer
              ? `/farmers?search=${encodeURIComponent(q)}`
              : `/lands?search=${encodeURIComponent(q)}`,
          );
        }}
      />
    </AutoComplete>
  );
}
