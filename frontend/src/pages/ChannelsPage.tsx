import { useParams } from "react-router-dom";
import { PageHeader } from "../components/common/PageHeader";
import { ChannelConfigEditor } from "../components/instances/ChannelConfigEditor";

export function ChannelsPage() {
  const { slug } = useParams<{ slug: string }>();
  if (!slug) return <p className="muted">Missing instance slug</p>;

  return (
    <>
      <PageHeader title={`Channels — ${slug}`} subtitle="Instance communication channels" backTo={`/instances/${slug}`} />
      <ChannelConfigEditor slug={slug} />
    </>
  );
}
