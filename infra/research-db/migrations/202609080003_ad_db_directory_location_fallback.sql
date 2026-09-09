-- Keep established directory locations searchable while locality foreign keys are incomplete.
-- No guessed locality or targeting, no provider call, and no changes to archived ads.
begin;
create or replace view research.v_ad_db_ads as
SELECT oa.id,
    oa.external_ad_id AS library_id,
    oa.advertiser_page_id,
    ap.page_id AS advertiser_page_meta_id,
    ap.page_name,
    oa.active_status,
    oa.first_seen_at,
    oa.last_seen_at,
    oa.last_checked_at,
    oa.ad_delivery_started_at,
    oa.ad_delivery_stopped_at,
    oa.ad_creation_date,
    ac.id AS ad_creative_id,
    ac.format,
    ac.headline,
    ac.body,
    ac.cta,
    ac.ad_type,
    ac.primary_intent,
    ac.classification,
    ac.display_state,
    jsonb_build_object('agent',
        CASE
            WHEN ag.id IS NULL THEN NULL::jsonb
            ELSE jsonb_build_object('id', ag.id, 'name', ag.full_name, 'relationship',
            CASE
                WHEN ap.owner_type = 'agent'::text THEN 'owner'::text
                ELSE 'ad_page_association'::text
            END)
        END, 'agency',
        CASE
            WHEN ay.id IS NULL THEN NULL::jsonb
            ELSE jsonb_build_object('id', ay.id, 'name', ay.name, 'relationship',
            CASE
                WHEN ap.agency_id IS NULL AND ag.agency_id = ay.id THEN 'member_agency'::text
                WHEN ap.owner_type = 'agency'::text THEN 'owner'::text
                ELSE 'ad_page_association'::text
            END)
        END) AS ownership,
    COALESCE(loc.locations, '[]'::jsonb)
    || CASE WHEN ag.primary_location_id IS NULL AND ag.primary_postcode ~ '^[0-9]{4}$'
       THEN jsonb_build_array(jsonb_build_object(
         'id', null, 'suburb', ag.primary_suburb, 'state', ag.state,
         'postcode', ag.primary_postcode, 'relation', 'office'))
       ELSE '[]'::jsonb END
    || CASE WHEN ay.primary_location_id IS NULL AND ay.primary_postcode ~ '^[0-9]{4}$'
         AND (ag.primary_postcode IS DISTINCT FROM ay.primary_postcode
           OR ag.primary_suburb IS DISTINCT FROM ay.primary_suburb
           OR ag.state IS DISTINCT FROM ay.state)
       THEN jsonb_build_array(jsonb_build_object(
         'id', null, 'suburb', ay.primary_suburb, 'state', ay.state,
         'postcode', ay.primary_postcode, 'relation', 'office'))
       ELSE '[]'::jsonb END AS locations,
    COALESCE(media.media, '[]'::jsonb) AS media
   FROM research.observed_ads oa
     JOIN research.advertiser_pages ap ON ap.id = oa.advertiser_page_id
     LEFT JOIN research.agents ag ON ag.id = ap.agent_id
     LEFT JOIN research.agencies ay ON ay.id = COALESCE(ap.agency_id, ag.agency_id)
     LEFT JOIN research.ad_creatives ac ON ac.observed_ad_id = oa.id
     LEFT JOIN LATERAL ( SELECT jsonb_agg(DISTINCT jsonb_build_object('id', l.id, 'suburb', l.suburb, 'state', l.state, 'postcode', l.postcode, 'relation', x.relation)) AS locations
           FROM ( SELECT ag.primary_location_id AS location_id,
                    'office'::text AS relation
                  WHERE ag.primary_location_id IS NOT NULL
                UNION ALL
                 SELECT ay.primary_location_id,
                    'office'::text AS text
                  WHERE ay.primary_location_id IS NOT NULL
                UNION ALL
                 SELECT li.location_id,
                    'property'::text AS text
                   FROM research.listings li
                  WHERE li.id = oa.listing_id AND li.location_id IS NOT NULL
                UNION ALL
                 SELECT service_location.id,
                    'service_area'::text AS text
                   FROM research.agent_service_areas asa
                     JOIN research.locations service_location ON service_location.postcode = asa.postcode AND service_location.suburb = asa.suburb AND service_location.state = asa.state
                  WHERE asa.agent_id = ag.id OR asa.agency_id = ay.id
                UNION ALL
                 SELECT ll.location_id,
                    ll.relation_type
                   FROM research.location_links ll
                  WHERE ll.subject_type = 'observed_ad'::text AND ll.subject_id = oa.id AND (ll.relation_type = ANY (ARRAY['meta_targeting'::text, 'copy_mention'::text])) AND ll.location_id IS NOT NULL) x
             JOIN research.locations l ON l.id = x.location_id) loc ON true
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'storageBucket', m.storage_bucket, 'objectKey', m.object_key, 'sha256', m.content_hash, 'byteSize', m.byte_size, 'mimeType', m.mime_type, 'width', m.width, 'height', m.height, 'durationMs', m.duration_ms) ORDER BY m.id) AS media
           FROM research.v_ad_db_archived_media m
          WHERE m.observed_ad_id = oa.id) media ON true;
commit;
